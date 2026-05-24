/**
 * See API Document in [API.md](https://github.com/siyuan-note/siyuan/blob/master/API.md)
 * API 文档见 [API_zh_CN.md](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)
 */

import { fetchPost, fetchSyncPost, IWebSocketData, openTab, Constants, platformUtils } from "siyuan";
import { getFrontend, openMobileFileById } from 'siyuan';

export async function request(url: string, data: any, returnType: 'data' | 'response' = 'data') {
    let response: IWebSocketData = await fetchSyncPost(url, data);
    let res = response.code === 0 ? response.data : null;
    return returnType === 'data' ? res : response;
}


// **************************************** Riff (闪卡) ****************************************

export async function addRiffCards(blockIDs: string[], deckID: string = Constants.QUICK_DECK_ID): Promise<any> {
    let data = {
        deckID: deckID,
        blockIDs: blockIDs
    };
    let url = '/api/riff/addRiffCards';
    return request(url, data);
}

export async function removeRiffCards(blockIDs: string[], deckID: string = Constants.QUICK_DECK_ID): Promise<any> {
    let data = {
        deckID: deckID,
        blockIDs: blockIDs
    };
    let url = '/api/riff/removeRiffCards';
    return request(url, data);
}

export async function getRiffDecks(): Promise<any> {
    let url = '/api/riff/getRiffDecks';
    return request(url, {});
}

export async function createRiffDeck(name: string): Promise<any> {
    let data = {
        name: name
    };
    let url = '/api/riff/createRiffDeck';
    return request(url, data);
}

export async function removeRiffDeck(deckID: string): Promise<any> {
    let data = {
        deckID: deckID
    };
    let url = '/api/riff/removeRiffDeck';
    return request(url, data);
}

export async function renameRiffDeck(deckID: string, name: string): Promise<any> {
    let data = {
        deckID: deckID,
        name: name
    };
    let url = '/api/riff/renameRiffDeck';
    return request(url, data);
}

export async function getRiffCards(deckID: string): Promise<any> {
    let data = {
        deckID: deckID
    };
    let url = '/api/riff/getRiffCards';
    return request(url, data);
}


// **************************************** Noteboook ****************************************


export async function lsNotebooks(): Promise<IReslsNotebooks> {
    let url = '/api/notebook/lsNotebooks';
    const res = await request(url, '');
    try {
        if (res && res.notebooks && Array.isArray(res.notebooks)) {
            // 只返回未关闭的笔记本
            res.notebooks = res.notebooks.filter((n: any) => n.closed === false || n.closed === 0 || n.closed === 'false' ? true : false);
        }
    } catch (e) {
        console.error('Filter notebooks error:', e);
    }
    return res;
}


export async function openNotebook(notebook: NotebookId) {
    let url = '/api/notebook/openNotebook';
    return request(url, { notebook: notebook });
}


export async function closeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/closeNotebook';
    return request(url, { notebook: notebook });
}


export async function renameNotebook(notebook: NotebookId, name: string) {
    let url = '/api/notebook/renameNotebook';
    return request(url, { notebook: notebook, name: name });
}


export async function createNotebook(name: string): Promise<Notebook> {
    let url = '/api/notebook/createNotebook';
    return request(url, { name: name });
}


export async function removeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/removeNotebook';
    return request(url, { notebook: notebook });
}


export async function getNotebookConf(notebook: NotebookId): Promise<IResGetNotebookConf> {
    let data = { notebook: notebook };
    let url = '/api/notebook/getNotebookConf';
    return request(url, data);
}


export async function setNotebookConf(notebook: NotebookId, conf: NotebookConf): Promise<NotebookConf> {
    let data = { notebook: notebook, conf: conf };
    let url = '/api/notebook/setNotebookConf';
    return request(url, data);
}


// **************************************** File Tree ****************************************

export async function getDoc(id: BlockId) {
    let data = {
        id: id
    };
    let url = '/api/filetree/getDoc';
    return request(url, data);
}


export async function createDocWithMd(notebook: NotebookId, path: string, markdown: string): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        markdown: markdown,
    };
    let url = '/api/filetree/createDocWithMd';
    return request(url, data);
}


export async function renameDoc(notebook: NotebookId, path: string, title: string): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        title: title
    };
    let url = '/api/filetree/renameDoc';
    return request(url, data);
}

export async function renameDocByID(id: string, title: string): Promise<DocumentId> {
    let data = {
        id: id,
        title: title
    };
    let url = '/api/filetree/renameDocByID';
    return request(url, data);
}


export async function removeDoc(notebook: NotebookId, path: string) {
    let data = {
        notebook: notebook,
        path: path,
    };
    let url = '/api/filetree/removeDoc';
    return request(url, data);
}


export async function moveDocs(fromPaths: string[], toNotebook: NotebookId, toPath: string) {
    let data = {
        fromPaths: fromPaths,
        toNotebook: toNotebook,
        toPath: toPath
    };
    let url = '/api/filetree/moveDocs';
    return request(url, data);
}

export async function moveDocsByID(fromIDs: string[], toID: string) {
    let data = {
        fromIDs: fromIDs,
        toID: toID
    };
    let url = '/api/filetree/moveDocsByID';
    return request(url, data);
}


export async function getHPathByPath(notebook: NotebookId, path: string): Promise<string> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getHPathByPath';
    return request(url, data);
}


export async function getHPathByID(id: BlockId): Promise<string> {
    let data = {
        id: id
    };
    let url = '/api/filetree/getHPathByID';
    return request(url, data);
}


export async function getIDsByHPath(notebook: NotebookId, path: string): Promise<BlockId[]> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getIDsByHPath';
    return request(url, data);
}

export async function listDocsByPath(notebook: NotebookId, path: string, sort: number = 15, showHidden: boolean = false, maxListCount: number = 10000): Promise<any> {
    let data = {
        notebook: notebook,
        path: path,
        sort: sort,
        showHidden: showHidden,
        maxListCount: maxListCount
    };
    let url = '/api/filetree/listDocsByPath';
    return request(url, data);
}

export async function searchDocs(k: string, flashcard: boolean = false): Promise<IResSearchDocs[]> {
    let data = {
        k: k,
        flashcard: flashcard
    };
    let url = '/api/filetree/searchDocs';
    return request(url, data);
}

// **************************************** Asset Files ****************************************

export async function upload(assetsDirPath: string, files: any[]): Promise<IResUpload> {
    let form = new FormData();
    form.append('assetsDirPath', assetsDirPath);
    for (let file of files) {
        form.append('file[]', file);
    }
    let url = '/api/asset/upload';
    return request(url, form);
}

// **************************************** Block ****************************************
type DataType = "markdown" | "dom";
export async function insertBlock(
    dataType: DataType, data: string,
    nextID?: BlockId, previousID?: BlockId, parentID?: BlockId
): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        nextID: nextID,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/insertBlock';
    return request(url, payload);
}


export async function prependBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/prependBlock';
    return request(url, payload);
}


export async function appendBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/appendBlock';
    return request(url, payload);
}


export async function updateBlock(dataType: DataType, data: string, id: BlockId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        id: id
    }
    let url = '/api/block/updateBlock';
    return request(url, payload);
}


export async function deleteBlock(id: BlockId): Promise<IResdoOperations[]> {
    let data = {
        id: id
    }
    let url = '/api/block/deleteBlock';
    return request(url, data);
}


export async function moveBlock(id: BlockId, previousID?: PreviousID, parentID?: ParentID): Promise<IResdoOperations[]> {
    let data = {
        id: id,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/moveBlock';
    return request(url, data);
}


export async function foldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/foldBlock';
    return request(url, data);
}


export async function unfoldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/unfoldBlock';
    return request(url, data);
}
export async function refreshSql() {
    return fetchSyncPost('/api/sqlite/flushTransaction');
}

export async function getBlockKramdown(id: BlockId, mode: string = 'textmark'): Promise<IResGetBlockKramdown> {
    let data = {
        id: id,
        mode: mode // 'md' or 'textmark',
    }
    let url = '/api/block/getBlockKramdown';
    return request(url, data); // 返回值 data.kramdown
}
export async function getBlockDOM(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/getBlockDOM';
    return request(url, data);
}

export async function getChildBlocks(id: BlockId): Promise<IResGetChildBlock[]> {
    let data = {
        id: id
    }
    let url = '/api/block/getChildBlocks';
    return request(url, data);
}

export async function transferBlockRef(fromID: BlockId, toID: BlockId, refIDs: BlockId[]) {
    let data = {
        fromID: fromID,
        toID: toID,
        refIDs: refIDs
    }
    let url = '/api/block/transferBlockRef';
    return request(url, data);
}

// **************************************** Attributes ****************************************
export async function setBlockAttrs(id: BlockId, attrs: { [key: string]: string }) {
    let data = {
        id: id,
        attrs: attrs
    }
    let url = '/api/attr/setBlockAttrs';
    return request(url, data);
}


export async function getBlockAttrs(id: BlockId): Promise<{ [key: string]: string }> {
    let data = {
        id: id
    }
    let url = '/api/attr/getBlockAttrs';
    return request(url, data);
}

// **************************************** SQL ****************************************

export async function sql(sql: string): Promise<any[]> {
    let sqldata = {
        stmt: sql,
    };
    let url = '/api/query/sql';
    return request(url, sqldata);
}

export async function getBlockByID(blockId: string): Promise<Block> {
    let sqlScript = `select * from blocks where id ='${blockId}'`;
    let data = await sql(sqlScript);
    return data[0];
}

export async function openBlock(blockId: string) {
    // 检测块是否存在
    const block = await getBlockByID(blockId);
    if (!block) {
        throw new Error('块不存在');
    }
    // 判断是否是移动端
    const isMobile = getFrontend().endsWith('mobile');
    if (isMobile) {
        // 如果是mobile，直接打开块
        openMobileFileById(window.siyuan.ws.app, blockId);
        return;
    }
    // 判断块的类型
    const isDoc = block.type === 'd';
    if (isDoc) {
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus", "cb-get-scroll"]
            },
            keepCursor: false,
            removeCurrentTab: false,
            openNewTab: true
        });
    } else {
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus", "cb-get-context", "cb-get-hl"]
            },
            keepCursor: false,
            removeCurrentTab: false,
            openNewTab: true
        });

    }
}
// **************************************** Template ****************************************

export async function render(id: DocumentId, path: string): Promise<IResGetTemplates> {
    let data = {
        id: id,
        path: path
    }
    let url = '/api/template/render';
    return request(url, data);
}


export async function renderSprig(template: string): Promise<string> {
    let url = '/api/template/renderSprig';
    return request(url, { template: template });
}

// **************************************** File ****************************************



export async function getFile(path: string): Promise<any> {
    let data = {
        path: path
    }
    let url = '/api/file/getFile';
    return new Promise((resolve, _) => {
        fetchPost(url, data, (content: any) => {
            resolve(content)
        });
    });
}


/**
 * fetchPost will secretly convert data into json, this func merely return Blob
 * @param endpoint 
 * @returns 
 */
export const getFileBlob = async (path: string): Promise<Blob | null> => {
    const endpoint = '/api/file/getFile'
    try {
        let response = await fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                path: path
            })
        });
        if (!response.ok) {
            return null;
        }

        let blob = await response.blob();

        // 检查是否为 JSON 格式的错误信息
        // 只有当 Content-Type 是 json 时才检查
        if (blob.type.includes('application/json')) {
            const text = await blob.text();
            try {
                const json = JSON.parse(text);
                // SiYuan 错误响应通常包含 code 非 0
                if (typeof json.code === 'number' && json.code !== 0) {
                    return null;
                }
                // 是有效的 JSON 文件内容，重建 Blob
                return new Blob([text], { type: blob.type });
            } catch (e) {
                // 解析失败，可能是普通文本，直接返回原始 blob
                return blob;
            }
        }

        return blob;
    } catch (e) {
        console.error('getFileBlob error:', e);
        return null;
    }
}


export async function putFile(path: string, isDir: boolean, file: any) {
    let form = new FormData();
    form.append('path', path);
    form.append('isDir', isDir.toString());
    form.append('file', file);

    // 使用 fetch 直接发送 FormData，避免 fetchSyncPost 可能的 JSON 处理问题
    try {
        const response = await fetch('/api/file/putFile', {
            method: 'POST',
            body: form
        });
        const res = await response.json();
        if (res.code === 0) {
            // 如果成功且 data 为 null，返回 true 以便调用者知道成功了
            return res.data ?? true;
        }
        return null;
    } catch (e) {
        console.error('putFile error:', e);
        return null;
    }
}

export async function removeFile(path: string) {
    let data = {
        path: path
    }
    let url = '/api/file/removeFile';
    return request(url, data);
}



export async function readDir(path: string): Promise<IResReadDir> {
    let data = {
        path: path
    }
    let url = '/api/file/readDir';
    return request(url, data);
}


// **************************************** Export ****************************************

export async function exportMdContent(id: DocumentId, yfm: boolean = false, fillCSSVar: boolean = false, refMode: number = 2, embedMode: number = 0, adjustHeadingLevel: boolean = false): Promise<IResExportMdContent> {
    let data = {
        id: id,
        yfm: yfm,
        fillCSSVar: fillCSSVar, // true： 导出具体的css值，false：导出变量
        refMode: refMode, // 2：锚文本块链, 3：仅锚文本, 4：块引转脚注+锚点哈希
        embedMode: embedMode, //0：使用原始文本，1：使用 Blockquote
        adjustHeadingLevel: adjustHeadingLevel
    }
    let url = '/api/export/exportMdContent';
    return request(url, data);
}

export async function exportResources(paths: string[], name: string): Promise<IResExportResources> {
    let data = {
        paths: paths,
        name: name
    }
    let url = '/api/export/exportResources';
    return request(url, data);
}

// **************************************** Convert ****************************************

export type PandocArgs = string;
export async function pandoc(args: PandocArgs[]) {
    let data = {
        args: args
    }
    let url = '/api/convert/pandoc';
    return request(url, data);
}

// **************************************** Notification ****************************************

export async function pushMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushMsg";
    return request(url, payload);
}

export async function pushErrMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushErrMsg";
    return request(url, payload);
}

// **************************************** Network ****************************************
export async function forwardProxy(
    url: string, method: string = 'GET', payload: any = {},
    headers: any[] = [], timeout: number = 7000, contentType: string = "text/html"
): Promise<IResForwardProxy> {
    let data = {
        url: url,
        method: method,
        timeout: timeout,
        contentType: contentType,
        headers: headers,
        payload: payload
    }
    let url1 = '/api/network/forwardProxy';
    return request(url1, data);
}

/**
 * 将 forwardProxy 包装为类 fetch 接口，用于替代浏览器原生 fetch 绕过 CORS
 *
 * 限制：
 * - 不支持 streaming（因 body 为完整字符串）
 * - 不支持 AbortSignal
 * - 默认超时 120 秒（覆盖原 7000ms）
 */
export async function forwardProxyFetch(
    url: string,
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeout?: number;
    }
): Promise<{
    ok: boolean;
    status: number;
    headers: Headers;
    json: () => Promise<any>;
    text: () => Promise<string>;
}> {
    const method = init?.method || 'GET';
    const headersArray = Object.entries(init?.headers || {}).map(([name, value]) => ({
        [name]: value
    }));
    const result = await forwardProxy(
        url,
        method,
        init?.body || '',
        headersArray,
        init?.timeout || 120000,
        'application/json'
    );
    const responseHeaders = new Headers();
    Object.entries(result.headers || {}).forEach(([key, value]) => {
        responseHeaders.set(key, value);
    });
    return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        headers: responseHeaders,
        json: async () => JSON.parse(result.body),
        text: async () => result.body,
    };
}


// **************************************** AttributeView (Database) ****************************************

/**
 * 搜索数据库
 * @param keyword 搜索关键词
 * @param avID 可选的数据库ID，用于精确搜索
 */
export async function searchAttributeView(keyword: string, avID?: string): Promise<any> {
    let data: any = {
        keyword: keyword
    };
    if (avID) {
        data.avID = avID;
    }
    let url = '/api/av/searchAttributeView';
    return request(url, data);
}

/**
 * 获取数据库的列信息
 * @param avID 数据库ID
 */
export async function getAttributeViewKeysByAvID(avID: string): Promise<any> {
    let data = {
        avID: avID
    };
    let url = '/api/av/getAttributeViewKeysByAvID';
    return request(url, data);
}

/**
 * 渲染数据库视图内容
 * @param id 数据库ID
 * @param viewID 视图ID
 * @param pageSize 每页数量，默认9999999
 * @param page 页码，默认1
 * @param createIfNotExist 如果视图不存在是否创建
 */
export async function renderAttributeView(id: string, viewID: string, pageSize: number = 9999999, page: number = 1, createIfNotExist =false): Promise<any> {
    let data = {
        id: id,
        viewID: viewID,
        pageSize: pageSize,
        page: page,
        createIfNotExist: createIfNotExist

    };
    let url = '/api/av/renderAttributeView';
    return request(url, data);
}

/**
 * 添加数据库非绑定块和属性值
 * @param avID 数据库ID
 * @param blocksValues 二维数组，每个元素是一行的数据
 */
export async function appendAttributeViewDetachedBlocksWithValues(avID: string, blocksValues: any[][]): Promise<any> {
    let data = {
        avID: avID,
        blocksValues: blocksValues
    };
    let url = '/api/av/appendAttributeViewDetachedBlocksWithValues';
    return request(url, data);
}

/**
 * 添加数据库绑定块
 * @param avID 数据库ID
 * @param srcs 源块数组，包含id和isDetached字段
 */
export async function addAttributeViewBlocks(avID: string, srcs: Array<{ id: string, isDetached: boolean, itemID?: string }>): Promise<any> {
    let data = {
        avID: avID,
        srcs: srcs
    };
    let url = '/api/av/addAttributeViewBlocks';
    return request(url, data);
}

/**
 * 设置数据库块属性
 * @param avID 数据库ID
 * @param keyID 列ID
 * @param itemID 行ID/ItemID
 * @param value 属性值对象
 */
export async function setAttributeViewBlockAttr(avID: string, keyID: string, itemID: string, value: any): Promise<any> {
    let data = {
        avID: avID,
        keyID: keyID,
        itemID: itemID,
        value: value
    };
    let url = '/api/av/setAttributeViewBlockAttr';
    return request(url, data);
}

/**
 * 批量设置数据库块属性
 * @param avID 数据库ID
 * @param values 属性值数组
 */
export async function batchSetAttributeViewBlockAttrs(avID: string, values: Array<{ keyID: string, itemID: string, value: any }>): Promise<any> {
    let data = {
        avID: avID,
        values: values
    };
    let url = '/api/av/batchSetAttributeViewBlockAttrs';
    return request(url, data);
}

/**
 * 查询哪些数据库包含了指定块
 * @param id 块ID
 */
export async function getAttributeViewKeys(id: string): Promise<any> {
    let data = {
        id: id
    };
    let url = '/api/av/getAttributeViewKeys';
    return request(url, data);
}

/**
 * 根据ItemID获取绑定块ID
 * @param avID 数据库ID
 * @param itemIDs ItemID数组
 */
export async function getAttributeViewBoundBlockIDsByItemIDs(avID: string, itemIDs: string[]): Promise<any> {
    let data = {
        avID: avID,
        itemIDs: itemIDs
    };
    let url = '/api/av/getAttributeViewBoundBlockIDsByItemIDs';
    return request(url, data);
}

/**
 * 根据绑定块ID获取ItemID
 * @param avID 数据库ID
 * @param blockIDs 块ID数组
 */
export async function getAttributeViewItemIDsByBoundIDs(avID: string, blockIDs: string[]): Promise<any> {
    let data = {
        avID: avID,
        blockIDs: blockIDs
    };
    let url = '/api/av/getAttributeViewItemIDsByBoundIDs';
    return request(url, data);
}

/**
 * 添加数据库列
 * @param avID 数据库ID
 * @param keyName 列名称
 * @param keyType 列类型
 * @param previousKeyID 前一列ID，用于指定新列的位置（必需）
 * @param keyID 可选的列ID，如果不提供则自动生成
 * @param keyIcon 列图标，默认为空字符串
 */
export async function addAttributeViewKey(
    avID: string,
    keyName: string,
    keyType: string,
    previousKeyID: string,
    keyID?: string,
    keyIcon: string = ""
): Promise<any> {
    // 如果没有指定 keyID，自动生成一个
    const finalKeyID = keyID || window.Lute.NewNodeID();

    let data: any = {
        avID: avID,
        keyID: finalKeyID,
        keyName: keyName,
        keyType: keyType,
        keyIcon: keyIcon,
        previousKeyID: previousKeyID
    };

    let url = '/api/av/addAttributeViewKey';
    return request(url, data);
}

/**
 * 删除数据库列
 * @param avID 数据库ID
 * @param keyID 列ID
 */
export async function removeAttributeViewKey(avID: string, keyID: string): Promise<any> {
    let data = {
        avID: avID,
        keyID: keyID
    };
    let url = '/api/av/removeAttributeViewKey';
    return request(url, data);
}

/**
 * 删除数据库行
 * @param avID 数据库ID
 * @param srcIDs 要删除的行ID数组
 */
export async function removeAttributeViewBlocks(avID: string, srcIDs: string[]): Promise<any> {
    let data = {
        avID: avID,
        srcIDs: srcIDs
    };
    let url = '/api/av/removeAttributeViewBlocks';
    return request(url, data);
}

// **************************************** System ****************************************

export async function bootProgress(): Promise<IResBootProgress> {
    return request('/api/system/bootProgress', {});
}

export async function version(): Promise<string> {
    return request('/api/system/version', {});
}

export async function currentTime(): Promise<number> {
    return request('/api/system/currentTime', {});
}


export async function sendNotification(
    title: string,
    body: string,
    // 支持三种形式：
    // - 数字（秒）：延迟秒数
    // - Date 对象：具体的日期时间
    // - 字符串：ISO 8601 格式时间
    //   * 本地时间: "2026-03-12T11:50:00"（无时区后缀，表示本地时区）
    //   * UTC 时间: "2026-03-12T11:50:00Z"（带 Z 后缀，表示 UTC 时区）
    whenOrDelay: number | string | Date = 0,
    timeoutType: 'default' | 'never' = 'default'
) {
    let delayInSeconds = 0;

    if (typeof whenOrDelay === 'number') {
        delayInSeconds = Math.max(0, Math.floor(whenOrDelay));
    } else if (whenOrDelay instanceof Date) {
        const diffMs = whenOrDelay.getTime() - Date.now();
        delayInSeconds = Math.max(0, Math.ceil(diffMs / 1000));
    } else if (typeof whenOrDelay === 'string') {
        const t = Date.parse(whenOrDelay);
        console.log(`sendNotification: parsing time string "${whenOrDelay}", parsed timestamp=${t}, Date.now()=${Date.now()}`);
        if (isNaN(t)) {
            console.warn('sendNotification: invalid time string, sending immediately');
            delayInSeconds = 0;
        } else {
            const diffMs = t - Date.now();
            delayInSeconds = Math.max(0, Math.ceil(diffMs / 1000));
            console.log(`sendNotification: diffMs=${diffMs}, delayInSeconds=${delayInSeconds}`);
            if (delayInSeconds === 0 && diffMs < 0) {
                console.warn(`sendNotification: time "${whenOrDelay}" is in the past, sending immediately`);
            }
        }
    }
    console.log(`sendNotification: title="${title}", body="${body}", delayInSeconds=${delayInSeconds}, timeoutType=${timeoutType}`);
    return platformUtils.sendNotification({
        channel: "Siyuan Copilot",
        title: title,
        body: body,
        delayInSeconds: delayInSeconds,
        timeoutType: timeoutType,
    });
}

/**
 * 取消指定 ID 的通知
 * @param id 通知 ID（由 sendNotification 返回）
 */
export function cancelNotification(id: number): void {
    return platformUtils.cancelNotification(id);
}
