---
name: search
description: Search. Actions: fulltext(query, page=1, pageSize=20, notebook?, path?, type?, subtype?, method?, orderBy?, groupBy?), semantic(query, page=1, pageSize=20, notebook?, path?, type?, subtype?) — semantic needs AI embedding configured; asset(query, page=1, pageSize=32, ext?, method?, orderBy?) — full-text search inside asset file contents (PDF/Word/Excel/txt etc.), returns matched snippets with <mark> tags; getasset(path) — get the full indexed content of one asset file by its path (e.g. 'assets/foo.pdf').
---

# search

## action: fulltext

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `query` | `string` | 是 | Search keywords (required for fulltext/semantic/asset) | - |
| `page` | `number` | 否 | Page number (default 1) | - |
| `pageSize` | `number` | 否 | Results per page (default 20 for fulltext/semantic, 32 for asset) | - |
| `notebook` | `string` | 否 | Comma-separated notebook IDs to filter (optional, fulltext/semantic only) | - |
| `path` | `string` | 否 | Comma-separated path prefixes to filter (optional, fulltext/semantic only); for getasset, a single asset file path like 'assets/foo.pdf' | - |
| `type` | `string` | 否 | Comma-separated block types to filter, e.g. 'document,heading,paragraph' (optional, fulltext/semantic only) | - |
| `subtype` | `string` | 否 | Comma-separated block subtypes to filter, e.g. 'o,u,t' (optional, fulltext/semantic only) | - |
| `method` | `number` | 否 | Search method: fulltext/asset 0=keyword 1=query-syntax 2=sql 3=regex (default 0) | - |
| `orderBy` | `number` | 否 | Sort order — fulltext: 0=type 1=created-asc 2=created-desc 3=updated-asc 4=updated-desc 5=content 6=relevance-asc 7=relevance-desc; asset: 0=relevance-desc 1=relevance-asc 2=updated-asc 3=updated-desc (default 0) | - |
| `groupBy` | `number` | 否 | Group by (fulltext only): 0=none 1=document (default 0) | - |

### 使用示例

```javascript
search({
  "action": "fulltext",
  "query": "...",
  "page": "...",
  "pageSize": "...",
  "notebook": "20211229091211-7v5p54a",
  "path": "...",
  "type": "...",
  "subtype": "...",
  "method": "...",
  "orderBy": "...",
  "groupBy": "..."
})
```

---

## action: semantic
full-text search inside asset file contents (PDF/Word/Excel/txt etc.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `query` | `string` | 是 | Search keywords (required for fulltext/semantic/asset) | - |
| `page` | `number` | 否 | Page number (default 1) | - |
| `pageSize` | `number` | 否 | Results per page (default 20 for fulltext/semantic, 32 for asset) | - |
| `notebook` | `string` | 否 | Comma-separated notebook IDs to filter (optional, fulltext/semantic only) | - |
| `path` | `string` | 否 | Comma-separated path prefixes to filter (optional, fulltext/semantic only); for getasset, a single asset file path like 'assets/foo.pdf' | - |
| `type` | `string` | 否 | Comma-separated block types to filter, e.g. 'document,heading,paragraph' (optional, fulltext/semantic only) | - |
| `subtype` | `string` | 否 | Comma-separated block subtypes to filter, e.g. 'o,u,t' (optional, fulltext/semantic only) | - |

### 使用示例

```javascript
search({
  "action": "semantic",
  "query": "...",
  "page": "...",
  "pageSize": "...",
  "notebook": "20211229091211-7v5p54a",
  "path": "...",
  "type": "...",
  "subtype": "..."
})
```

---

## action: asset
full-text search inside asset file contents (PDF/Word/Excel/txt etc.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `query` | `string` | 是 | Search keywords (required for fulltext/semantic/asset) | - |
| `page` | `number` | 否 | Page number (default 1) | - |
| `pageSize` | `number` | 否 | Results per page (default 20 for fulltext/semantic, 32 for asset) | - |
| `ext` | `string` | 否 | Comma-separated asset file extensions to filter, e.g. 'pdf,docx,xlsx' (optional, asset only) | - |
| `method` | `number` | 否 | Search method: fulltext/asset 0=keyword 1=query-syntax 2=sql 3=regex (default 0) | - |
| `orderBy` | `number` | 否 | Sort order — fulltext: 0=type 1=created-asc 2=created-desc 3=updated-asc 4=updated-desc 5=content 6=relevance-asc 7=relevance-desc; asset: 0=relevance-desc 1=relevance-asc 2=updated-asc 3=updated-desc (default 0) | - |

### 使用示例

```javascript
search({
  "action": "asset",
  "query": "...",
  "page": "...",
  "pageSize": "...",
  "ext": "...",
  "method": "...",
  "orderBy": "..."
})
```

---

## action: getasset
get the full indexed content of one asset file by its path (e.g. 'assets/foo.pdf').

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Comma-separated path prefixes to filter (optional, fulltext/semantic only); for getasset, a single asset file path like 'assets/foo.pdf' | - |

### 使用示例

```javascript
search({
  "action": "getasset",
  "path": "..."
})
```

---

