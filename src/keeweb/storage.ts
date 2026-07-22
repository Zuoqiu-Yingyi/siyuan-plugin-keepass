// Copyright (C) 2023 Zuoqiu Yingyi
// 
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
// 
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
// 
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// @ts-expect-error 引用 keeweb 中的模块
import { Comparators } from "util/data/comparators";
// @ts-expect-error 引用 keeweb 中的模块
import { Locale } from "util/locale";

// @ts-expect-error 引用 keeweb 中的模块
import { Alerts } from "comp/ui/alerts";
// @ts-expect-error 引用 keeweb 中的模块
import { Storage } from "storage/index";
// @ts-expect-error 引用 keeweb 中的模块
import { StorageBase } from "storage/storage-base";
// @ts-expect-error 引用 keeweb 中的模块
import { StorageFileListView } from "views/storage-file-list-view";

import {
    join,
    parse,
} from "@workspace/utils/path/browserify";

import type {
    IContext,
    IStorageOpenConfig,
} from ".";

export {
    Storage,
    StorageBase,
};

export interface IStat {
    rev?: string; // 文件修改时间
}

export interface IEntry {
    name: string; // 条目名
    path: string; // 条目路径
    rev: string; // 条目最后修改时间
    dir: boolean | string; // 是否为目录
}

export type TError<T = any> = null | T | undefined;
export interface IStatError {
    notFound: boolean;
    msg?: string;
};

export interface IChooserResult {
    name: string; // 文件名
    data: BlobPart; // 文件内容
}

export type TChooserCallback = (
    err?: TError,
    res?: IChooserResult,
) => void;

interface IChooserConfig {
    dir?: string; // 当前目录
    prevDir?: string; // 上级目录
}

class SiyuanFileChooser {
    protected alert?: any;
    protected result?: IEntry;
    protected pathStack: string[] = [];
    protected cb?: TChooserCallback;

    constructor(
        protected storage: SiyuanStorage,
        callback: TChooserCallback,
    ) {
        this.cb = callback;
    }

    public choose(): void {
        this.pathStack.length = 0;
        this.list();
    }

    protected callback(err?: TError, res?: IChooserResult): void {
        if (this.cb) {
            this.cb(err, res);
        }
        this.cb = undefined;
    }

    protected list(config?: IChooserConfig): void {
        this.closeAlert();
        this.storage.list(config?.dir, (err, files) => {
            if (err || !files) {
                return this.callback(err || "list error");
            }

            files = this.prepareFiles(files, config);
            if (!files.length) {
                return this.callback("empty");
            }

            const listView = new StorageFileListView({
                files,
                showAllFiles: true,
            });
            listView.on("selected", (file: IEntry) => {
                if (file.dir) {
                    if (file.name === "..") {
                        this.pathStack.pop();
                    }
                    else {
                        this.pathStack.push(file.path);
                    }
                    this.list({
                        dir: file.path,
                        prevDir: this.pathStack[this.pathStack.length - 2] || "",
                    });
                }
                else {
                    this.closeAlert();
                    this.success(file);
                }
            });
            this.alert = Alerts.alert({
                header: Locale.openSelectFile,
                body: Locale.openSelectFileBody,
                icon: this.storage.icon || "file-alt",
                buttons: [{
                    result: "",
                    title: Locale.alertCancel,
                }],
                esc: "",
                click: "",
                view: listView,
                cancel: () => {
                    this.alert = undefined;
                    if (!this.result) {
                        this.callback("closed");
                    }
                },
            });
        });
    }

    protected prepareFiles(files: IEntry[], config?: IChooserConfig): IEntry[] {
        const fileNameComparator = Comparators.stringComparator("path", true);
        files = files.slice().sort((x, y) => {
            if (x.dir !== y.dir) {
                return Number(!!y.dir) - Number(!!x.dir);
            }
            return fileNameComparator(x, y);
        });
        if (config?.dir) {
            files.unshift({
                path: config.prevDir || "",
                name: "..",
                dir: true,
                rev: "",
            });
        }
        return files;
    }

    protected closeAlert(): void {
        if (this.alert) {
            const alert = this.alert;
            this.alert = undefined;
            alert.closeWithoutResult();
        }
    }

    protected success(file: IEntry): void {
        if (!file.path || file.dir) {
            return this.callback("bad result");
        }
        this.result = file;
        this.readFile(file.path);
    }

    protected readFile(path: string): void {
        this.storage.load(path, {}, (err, data) => {
            if (err || !data) {
                return this.callback(err || "read error");
            }
            this.callback(null, {
                name: this.result!.name,
                data,
            });
        });
    }
}

export class SiyuanStorage extends StorageBase {
    public readonly name: string;
    public readonly icon: string;
    public readonly prefix: string;
    public readonly uipos = -10;

    public declare appSettings: any;
    public enabled: boolean = true;
    public backup: boolean = true;

    protected connected: boolean = false; // 是否可访问思源服务
    protected authorized: boolean = false; // 是否通过思源服务的认证

    constructor(
        protected _context: IContext,
    ) {
        super();
        this.name = this._context.manifest.name;
        this.icon = this.name;
        this.prefix = `plugin:${this.name}`;
    }

    public get _logger(): Console {
        return super.logger || globalThis.console;
    }

    public init() {
        // this._logger.debug("storage-inited", arguments);
        super.init();
        this.updateServiceStatus();
    }

    /**
     * 更新思源服务状态
     */
    public async updateServiceStatus(): Promise<void> {
        try {
            await this._context.client.version();
            this.connected = true;
            try {
                await this._context.client.readDir({ path: "" });
                this.authorized = true;
            }
            catch (error) {
                void error;
                this.authorized = false;
            }
        }
        catch (error) {
            void error;
            this.connected = false;
            this.authorized = false;
        }
    }

    /**
     * 通过数据库名生成文件保存路径
     * @param fileName - 文件名
     * @returns 文件路径
     */
    public getPathForName(fileName: string): string {
        // this._logger.debug("storage-getPathForName", arguments);
        return join(this._context.path, `${fileName}.kdbx`);
    }

    /**
     * 创建思源文件选择器
     * @param callback - 回调函数
     */
    public SiyuanChooser(callback: TChooserCallback): SiyuanFileChooser {
        return new SiyuanFileChooser(this, callback);
    }

    /**
     * 加载文件
     * @param path - 文件路径
     * @param opts - 选项
     * @param callback - 回调函数
     */
    public load(
        path: string,
        opts: any,
        callback?: (
            err?: TError,
            data?: BlobPart,
            stat?: IStat,
        ) => void,
    ) {
        // this._logger.debug("storage-load", arguments);
        this.stat(path, opts, (err, stat) => {
            if (err) {
                callback?.(err);
            }
            else {
                this._context.client.getFile({ path }, "arraybuffer")
                    .then((response) => {
                        callback?.(null, response, stat);
                    })
                    .catch((error) => {
                        callback?.(error);
                    });
            }
        });
    }

    /**
     * 获取文件状态
     * @param path - 文件路径
     * @param _opts - 选项
     * @param callback - 回调函数
     */
    public stat(
        path: string,
        _opts: any,
        callback?: (
            err?: TError<IStatError>,
            stat?: IStat,
        ) => void,
    ) {
        // this._logger.debug("storage-stat", arguments);
        const info = parse(path);
        this._context.client.readDir({ path: info.dir })
            .then((response) => {
                const entry = response.data.find((entry) => entry.name === info.base);
                if (entry) {
                    callback?.(null, {
                        rev: String(entry.updated),
                    });
                }
                else {
                    callback?.({
                        notFound: true,
                        msg: `File [${info.base}] is not under directory [${info.dir}]`,
                    });
                    // callback?.(null);
                }
            })
            .catch((error) => {
                callback?.(error);
            });
    }

    /**
     * 保存文件
     * @param path - 文件路径
     * @param opts - 选项
     * @param data - 文件内容
     * @param callback - 回调函数
     */
    public save(
        path: string,
        opts: any,
        data: BlobPart,
        callback?: (
            err?: TError,
            stat?: IStat,
        ) => void,
    ) {
        // this._logger.debug("storage-save", arguments);
        this._context.client.putFile({ path, file: data })
            .then((_response) => {
                this.stat(path, opts, callback);
            })
            .catch((error) => {
                callback?.(error);
            });
    }

    /**
     * 创建目录
     * @param path - 目录路径
     * @param callback - 回调函数
     */
    public mkdir(
        path: string,
        callback?: (
            err?: TError,
        ) => void,
    ) {
        // this._logger.debug("storage-mkdir", arguments);
        this._context.client.putFile({ path, isDir: true })
            .then((_response) => {
                callback?.(null);
            })
            .catch((error) => {
                callback?.(error);
            });
    }

    /**
     * 列出目录内容
     * @param dir - 目录路径
     * @param callback - 回调函数
     */
    public async list(
        dir: string | void,
        callback?: (
            err?: TError,
            entries?: IEntry[],
        ) => void,
    ) {
        // eslint-disable-next-line prefer-rest-params
        this._logger.debug("storage-list", arguments);
        try {
            const path = dir || this._context.fileOpenPath;
            const response = await this._context.client.readDir({ path });
            callback?.(null, response.data.map((entry) => ({
                name: entry.name,
                path: join(path, entry.name),
                dir: entry.isDir,
                rev: String(entry.updated),
            })));
        }
        catch (error) {
            callback?.(error);
        }
    }

    /**
     * 删除资源
     * @param path - 资源路径
     * @param callback - 回调函数
     */
    public remove(
        path: string,
        callback?: (
            err?: TError,
        ) => void,
    ) {
        // this._logger.debug("storage-remove", arguments);
        this._context.client.removeFile({ path })
            .then((_response) => {
                callback?.(null);
            })
            .catch((error) => {
                callback?.(error);
            });
    }

    /**
     * 在打开文件时是否需要显示配置对话框
     * 在未连接至思源服务时显示
     */
    public needShowOpenConfig(): boolean {
        // this._logger.debug("storage-needShowOpenConfig", arguments);
        return !this.connected || !this.authorized;
    }

    /**
     * 打开文件时显示的配置对话框内容
     */
    public getOpenConfig(): IStorageOpenConfig {
        // this._logger.debug("storage-getOpenConfig", arguments);
        switch (false) {
            // eslint-disable-next-line default-case-last
            default:
            case this.connected:
                return {
                    desc: "siyuanStorageDescConnect",
                    fields: [
                        {
                            id: "baseURL",
                            type: "url",
                            title: "siyuanBaseURL",
                            placeholder: "http[s]://host[:port]/[pathname]",
                            required: true,
                            pattern: "^https?://.*$",
                        },
                    ],
                };

            case this.authorized:
                return {
                    desc: "siyuanStorageDescAuthorize",
                    fields: [
                        {
                            id: "token",
                            type: "text",
                            title: "siyuanToken",
                            required: true,
                        },
                    ],
                };
        }
    }

    /**
     * 打开文件对话框的确认按钮回调
     */
    public async applyConfig(
        config: {
            baseURL?: string;
            token?: string;
        },
        callback: (
            err?: TError,
        ) => void,
    ): Promise<void> {
        // this._logger.debug("storage-applyConfig", arguments);
        this._context.client._updateOptions({ ...config }, this._context.type);
        await this.updateServiceStatus();
        switch (true) {
            case ("baseURL" in config):
                if (this.connected) {
                    this.appSettings[`${this.prefix}:baseURL`] = config.baseURL;
                    this.appSettings.save();
                    callback();
                }
                else {
                    callback(this._context.i18n!.siyuanStorageDescConnect);
                }
                break;

            case ("token" in config):
                if (this.authorized) {
                    this.appSettings[`${this.prefix}:token`] = config.token;
                    this.appSettings.save();
                    callback();
                }
                else {
                    callback(this._context.i18n!.siyuanStorageDescAuthorize);
                }
                break;

            default:
                callback();
                break;
        }
    }

    /**
     * getSettingsConfig
     */
    // public getSettingsConfig(): IStorageSettingsConfig {
    //     this._logger.debug("storage-getSettingsConfig", arguments);
    //     return {
    //         desc: "siyuanStorageDesc",
    //         fields: [
    //         ]
    //     }
    // }

    /**
     * 更改设置项 (设置 - 通用 - 储存)
     * @param key - 设置项键
     * @param value - 设置项值
     */
    // public applySetting(
    //     key: string,
    //     value: any,
    // ) {
    //     this._logger.debug("storage-applySetting", arguments);
    // }

    /**
     * 注销登录
     */
    public logout() {
        // eslint-disable-next-line prefer-rest-params
        this._logger.debug("storage-logout", arguments);
        // TODO: logoutAuth
    }
}

export function install(context: IContext) {
    // this._logger.debug("plugin:siyuan:storage-install");
    const siyuanStorage = new SiyuanStorage(context); ;
    context.storage = siyuanStorage;
    Storage.siyuan = siyuanStorage;
}

export function uninstall(_context: IContext) {
    // this._logger.debug("plugin:siyuan:storage-install");
    delete Storage.siyuanStorage;
}
