import { i18n, tf } from './i18n';
/**
 * 网页解析工具 - 将网页链接解析为 Markdown
 * @module webParser
 */

import { Readability } from '@mozilla/readability';

/**
 * 清理 Markdown 中的多余空白行
 * - 删除连续的多个空行，最多保留一个
 * - 删除行首和行尾的空白字符
 * - 清理全文前后的空白
 * @param markdown 原始 Markdown 文本
 * @returns 清理后的 Markdown 文本
 */
export function cleanMarkdownBlankLines(markdown: string): string {
    if (!markdown) return markdown;
    
    return markdown
        // 按行分割
        .split('\n')
        // 删除行尾空白字符
        .map(line => line.trimEnd())
        // 重新组合
        .join('\n')
        // 将连续3个或以上的换行符替换为2个（保留段落间距）
        .replace(/\n{3,}/g, '\n\n')
        // 清理全文前后的空白
        .trim();
}

/**
 * 处理粗体样式为 <b> 标签
 */
function processBoldStyle(element: HTMLElement) {
    const boldElements = element.querySelectorAll('*');
    boldElements.forEach(el => {
        if (el.tagName === 'B' || el.tagName === 'STRONG') return;
        const style = window.getComputedStyle(el);
        if (style.fontWeight === 'bold' || style.fontWeight === '700') {
            const b = document.createElement('b');
            while (el.firstChild) {
                b.appendChild(el.firstChild);
            }
            el.appendChild(b);
        }
    });
}

/**
 * 简化嵌套标签
 */
function simplifyNestedTags(root: HTMLElement, tagName: string) {
    let elements = root.querySelectorAll(tagName);
    let hasNested = true;
    while (hasNested) {
        hasNested = false;
        elements.forEach(element => {
            const nested = element.querySelector(tagName);
            if (nested) {
                hasNested = true;
                while (nested.firstChild) {
                    element.insertBefore(nested.firstChild, nested);
                }
                nested.remove();
            }
        });
        elements = root.querySelectorAll(tagName);
    }
}

/**
 * 移除图片链接
 */
function removeImgLink(element: HTMLElement) {
    const images = element.querySelectorAll('img');
    images.forEach(img => {
        const parent = img.parentElement;
        if (parent && parent.tagName === 'A') {
            const grandParent = parent.parentElement;
            if (grandParent) {
                grandParent.insertBefore(img, parent);
                parent.remove();
            }
        }
    });
}

/**
 * 移除常见的非内容元素（导航、页脚、侧边栏等）
 */
function removeNonContentElements(doc: Document) {
    // 常见的非内容元素选择器
    const selectorsToRemove = [
        'nav', 'header', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '.navigation', '.nav', '.navbar', '.header', '.footer', '.sidebar',
        '.menu', '.breadcrumb', '.pagination', '.advertisement', '.ad',
        // GitHub 特定的选择器
        '.Header', '.footer', '.BorderGrid', '.PageLayout-sidebar',
        '.AppHeader', '.AppFooter', '.js-navigation-container',
        // 移除脚本和样式
        'script', 'style', 'noscript'
    ];

    selectorsToRemove.forEach(selector => {
        try {
            const elements = doc.querySelectorAll(selector);
            elements.forEach(el => el.remove());
        } catch (e) {
            // 忽略无效的选择器
        }
    });
}

/**
 * 针对特定网站尝试直接提取内容
 * @param doc HTML 文档
 * @param url 网页 URL
 * @returns 如果成功提取返回 {content: string, title: string}，否则返回 null
 */
function tryExtractContentBySite(doc: Document, url: string): { content: string; title: string } | null {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;

        // GitHub issues/PR 页面
        if (hostname.includes('github.com') && (url.includes('/issues/') || url.includes('/pull/'))) {
            const titleEl = doc.querySelector('.js-issue-title, .markdown-title');
            const contentEl = doc.querySelector('.comment-body, .markdown-body');

            if (titleEl || contentEl) {
                const title = titleEl?.textContent?.trim() || doc.title;
                let content = '';

                if (contentEl) {
                    content = contentEl.innerHTML;
                } else {
                    // 如果找不到特定元素，尝试找 main 或 article
                    const mainEl = doc.querySelector('main, article, [role="main"]');
                    if (mainEl) {
                        content = mainEl.innerHTML;
                    }
                }

                if (content) {
                    return { content, title };
                }
            }
        }

        // 知乎专栏文章
        if (hostname.includes('zhihu.com') && url.includes('/p/')) {
            const titleEl = doc.querySelector('h1.Post-Title, .Post-Title');
            const contentEl = doc.querySelector('.Post-RichTextContainer, .RichText, article');

            if (titleEl || contentEl) {
                const title = titleEl?.textContent?.trim() || doc.title;
                let content = '';

                if (contentEl) {
                    content = contentEl.innerHTML;
                } else {
                    // 尝试其他可能的内容容器
                    const mainEl = doc.querySelector('main, article, [role="main"]');
                    if (mainEl) {
                        content = mainEl.innerHTML;
                    }
                }

                if (content) {
                    return { content, title };
                }
            }
        }

        // 可以在这里添加更多特定网站的处理逻辑

    } catch (e) {
        // 解析失败，返回 null
    }

    return null;
}

/**
 * 转换自定义列表结构为标准 HTML 列表
 * 处理类似 data-type="list" 和 data-type="list-item" 这样的自定义列表结构
 */
function convertCustomLists(element: HTMLElement) {
    // 查找所有自定义列表容器
    const customLists = element.querySelectorAll('[data-type="list"]');

    customLists.forEach(listContainer => {
        // 查找所有列表项
        const listItems = listContainer.querySelectorAll('[data-type="list-item"]');

        if (listItems.length === 0) return;

        // 判断是有序列表还是无序列表
        // 如果有 data-orderer="true" 或者有明确的序号，使用 <ol>，否则使用 <ul>
        const firstItem = listItems[0];
        const isOrdered = firstItem.getAttribute('data-orderer') === 'true';

        // 创建标准列表元素
        const standardList = document.createElement(isOrdered ? 'ol' : 'ul');

        // 转换每个列表项
        listItems.forEach(item => {
            const li = document.createElement('li');

            // 提取列表项的文本内容
            // 通常文本内容在某个子元素中，我们需要找到实际的内容
            const contentContainer = item.querySelector('section, p, div.markdown-child-root');

            if (contentContainer) {
                // 将内容移动到 li 中
                li.innerHTML = contentContainer.innerHTML || contentContainer.textContent || '';
            } else {
                // 如果找不到特定容器，使用整个元素的文本内容
                li.textContent = item.textContent || '';
            }

            standardList.appendChild(li);
        });

        // 替换原始的自定义列表
        listContainer.parentElement?.replaceChild(standardList, listContainer);
    });
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试和 CORS 代理的 fetch
 * @param url 请求 URL
 * @param maxRetries 最大重试次数
 * @param retryDelay 重试延迟（毫秒）
 */
async function fetchWithRetry(
    url: string,
    maxRetries: number = 3,
    retryDelay: number = 1000
): Promise<string> {
    let lastError: Error | null = null;

    // 根据不同网站定制请求头
    const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'Cache-Control': 'max-age=0'
    };

    try {
        const urlObj = new URL(url);
        // 知乎特定的请求头
        if (urlObj.hostname.includes('zhihu.com')) {
            headers['Referer'] = 'https://www.zhihu.com/';
            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        }
    } catch (e) {
        // 忽略 URL 解析错误
    }

    // 首先尝试直接获取
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url, { headers });

            if (!response.ok) {
                // 如果是 429 错误且还有重试机会，等待后重试
                if (response.status === 429 && attempt < maxRetries - 1) {
                    const waitTime = retryDelay * Math.pow(2, attempt);
                    console.warn(`请求被限速 (429)，${waitTime}ms 后重试 (${attempt + 1}/${maxRetries}): ${url}`);
                    await delay(waitTime);
                    continue;
                }

                // 如果是 403 或其他错误，直接跳出循环尝试代理
                if (response.status === 403 || response.status >= 400) {
                    lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
                    break;
                }

                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.text();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // 网络错误也可以重试
            if (attempt < maxRetries - 1) {
                const waitTime = retryDelay * Math.pow(2, attempt);
                console.warn(`请求失败，${waitTime}ms 后重试 (${attempt + 1}/${maxRetries}): ${url}`, error);
                await delay(waitTime);
                continue;
            }

            // 直接请求失败，跳出循环尝试代理
            break;
        }
    }

    // 如果直接请求失败，尝试使用 CORS 代理服务
    console.warn(`直接请求失败，尝试使用 CORS 代理: ${url}`);

    const corsProxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    ];

    for (const proxyUrl of corsProxies) {
        try {
            console.log(`尝试代理: ${proxyUrl.split('?')[0]}`);
            const response = await fetch(proxyUrl, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                }
            });

            if (response.ok) {
                const html = await response.text();
                if (html && html.length > 0) {
                    console.log(`通过代理成功获取: ${proxyUrl.split('?')[0]}`);
                    return html;
                }
            }
        } catch (error) {
            console.warn(`代理失败 (${proxyUrl.split('?')[0]}):`, error);
            lastError = error instanceof Error ? error : new Error(String(error));
            continue;
        }
    }

    throw lastError || new Error(i18n('webParserRequestsFailed'));
}

/**
 * 解析单个网页为 Markdown
 * @param url 网页 URL
 * @returns Promise<{success: boolean, markdown?: string, title?: string, error?: string, url: string}>
 */
export async function parseWebPageToMarkdown(
    url: string
): Promise<{
    success: boolean;
    markdown?: string;
    title?: string;
    error?: string;
    url: string;
}> {
    try {
        // 检查是否为知乎链接
        if (url.includes('zhihu.com')) {
            return {
                success: false,
                error: i18n('webParserZhihuUnsupported'),
                url
            };
        }

        // 使用带重试的 fetch 获取网页内容
        const html = await fetchWithRetry(url);

        // 使用 DOMParser 解析 HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 先尝试针对特定网站的内容提取
        const siteSpecificContent = tryExtractContentBySite(doc, url);

        let articleContent: string;
        let articleTitle: string;

        if (siteSpecificContent) {
            // 使用特定网站的提取结果
            articleContent = siteSpecificContent.content;
            articleTitle = siteSpecificContent.title;
        } else {
            // 在使用 Readability 之前，先移除明显的非内容元素
            removeNonContentElements(doc);

            // 在 Readability 处理之前，先将自定义列表转换为标准 HTML 列表
            // 这样 Readability 才能识别并保留这些列表内容
            if (doc.body) {
                convertCustomLists(doc.body as HTMLElement);
            }

            // 使用 Readability 提取主要内容
            const reader = new Readability(doc);
            const article = reader.parse();

            if (!article) {
                throw new Error(i18n('webParserParseFailed'));
            }

            articleContent = article.content;
            articleTitle = article.title;
        }

        // 创建临时容器进行处理
        const tempElement = document.createElement('div');
        tempElement.innerHTML = articleContent;

        // 处理粗体样式
        processBoldStyle(tempElement);

        // 简化嵌套标签
        simplifyNestedTags(tempElement, 'b');
        simplifyNestedTags(tempElement, 'strong');

        // 移除图片链接
        removeImgLink(tempElement);

        // 转换自定义列表结构为标准 HTML 列表
        convertCustomLists(tempElement);

        // 转换为 Markdown
        const lute = (window as any).Lute.New();
        let markdown = lute.HTML2Md(tempElement.innerHTML);
        
        // 清理空白行
        markdown = cleanMarkdownBlankLines(markdown);

        return {
            success: true,
            markdown,
            title: articleTitle,
            url
        };
    } catch (error) {
        console.error(`解析网页失败 (${url}):`, error);
        let errorMessage = error instanceof Error ? error.message : String(error);

        // 为常见错误提供更友好的提示
        if (errorMessage.includes('429')) {
            errorMessage = i18n('webParserRateLimited');
        } else if (errorMessage.includes('403')) {
            errorMessage = i18n('webParserForbidden');
        } else if (errorMessage.includes('404')) {
            errorMessage = i18n('webParserNotFound');
        } else if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
            errorMessage = i18n('webParserNetworkError');
        } else if (errorMessage === i18n('webParserRequestsFailed')) {
            errorMessage = i18n('webParserAccessRestricted');
        }

        return {
            success: false,
            error: errorMessage,
            url
        };
    }
}

/**
 * 批量解析多个网页为 Markdown
 * @param urls 网页 URL 数组
 * @param onProgress 进度回调函数
 * @param delayBetweenRequests 请求之间的延迟（毫秒），默认 500ms
 * @returns Promise<Array<{success: boolean, markdown?: string, title?: string, error?: string, url: string}>>
 */
export async function parseMultipleWebPages(
    urls: string[],
    onProgress?: (current: number, total: number, url: string, success: boolean) => void,
    delayBetweenRequests: number = 500
): Promise<Array<{
    success: boolean;
    markdown?: string;
    title?: string;
    error?: string;
    url: string;
}>> {
    const results: Array<{
        success: boolean;
        markdown?: string;
        title?: string;
        error?: string;
        url: string;
    }> = [];

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
            // 在非首次请求前添加延迟，避免速率限制
            if (i > 0 && delayBetweenRequests > 0) {
                await delay(delayBetweenRequests);
            }

            const result = await parseWebPageToMarkdown(url);
            results.push(result);

            if (onProgress) {
                onProgress(i + 1, urls.length, url, result.success);
            }
        } catch (error) {
            console.error(`批量解析网页时发生错误 (${url}):`, error);
            const errorResult = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                url
            };
            results.push(errorResult);

            if (onProgress) {
                onProgress(i + 1, urls.length, url, false);
            }
        }
    }

    return results;
}


/**
 * 使用 WebView 获取网页内容
 * 作为备用方案，当直接 fetch 失败时使用
 * @param url 要获取的网页 URL
 * @returns Promise<{ success: boolean; title?: string; markdown?: string; error?: string }>
 */
export async function fetchWithWebView(url: string): Promise<{ success: boolean; title?: string; markdown?: string; error?: string }> {
    return new Promise((resolve) => {
        const partitionName = 'get_siyuan_skillst:siyuan-copilot-webapp-shared';
        // 创建 webview 元素，使用 any 类型绕过类型检查
        const webview = document.createElement('webview') as any;
        
        // 设置 webview 属性
        webview.setAttribute('src', url);
        webview.setAttribute('partition', partitionName);
        webview.setAttribute('style', 'width:1px;height:1px;opacity:0;position:absolute;left:-9999px;');
        webview.setAttribute('nodeintegration', 'false');
        webview.setAttribute('webpreferences', 'contextIsolation=true,allowRunningInsecureContent=true');
        
        let timeoutId: NodeJS.Timeout;
        let isResolved = false;
        
        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (webview.parentNode) {
                webview.parentNode.removeChild(webview);
            }
        };
        
        const resolveOnce = (result: { success: boolean; title?: string; markdown?: string; error?: string }) => {
            if (!isResolved) {
                isResolved = true;
                cleanup();
                resolve(result);
            }
        };
        
        // 设置超时
        timeoutId = setTimeout(() => {
            resolveOnce({ success: false, error: i18n('webParserWebViewTimeout') });
        }, 30000); // 30秒超时
        
        // 页面加载完成
        webview.addEventListener('dom-ready', async () => {
            try {
                // 执行脚本提取内容
                const result = await webview.executeJavaScript(`
                    (function() {
                        try {
                            // 移除脚本和样式元素
                            document.querySelectorAll('script, style, nav, header, footer, aside, [role="navigation"]').forEach(el => el.remove());
                            
                            // 获取标题
                            const title = document.title || document.querySelector('h1')?.textContent || '';
                            
                            // 尝试找到主要内容区域
                            const article = document.querySelector('article, main, [role="main"], .content, .article, .post');
                            const content = article || document.body;
                            
                            if (!content) {
                                return { success: false, error: ${JSON.stringify(i18n('webParserPageContentMissing'))} };
                            }
                            
                            // 获取 HTML 内容
                            const html = content.innerHTML;
                            
                            return { 
                                success: true, 
                                title: title.trim(),
                                html: html
                            };
                        } catch (e) {
                            return { success: false, error: e.message };
                        }
                    })()
                `);
                
                if (result.success && result.html) {
                    // 使用 Lute 将 HTML 转换为 Markdown
                    const lute = (window as any).Lute.New();
                    let markdown = lute.HTML2Md(result.html);
                    
                    // 清理空白行
                    markdown = cleanMarkdownBlankLines(markdown);
                    
                    resolveOnce({
                        success: true,
                        title: result.title,
                        markdown: markdown
                    });
                } else {
                    resolveOnce({ success: false, error: result.error || i18n('webParserExtractionFailed') });
                }
            } catch (error) {
                resolveOnce({ 
                    success: false, 
                    error: tf('webParserWebViewError', error instanceof Error ? error.message : String(error))
                });
            }
        });
        
        // 加载失败
        webview.addEventListener('did-fail-load', (event: any) => {
            if (event.errorCode !== 0) {
                resolveOnce({ success: false, error: tf('webParserPageLoadFailed', event.errorCode) });
            }
        });
        
        // 添加到文档以开始加载
        document.body.appendChild(webview);
    });
}
