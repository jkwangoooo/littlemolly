// 备份文件格式：纯数据层，不碰 IndexedDB、也没有后端之分（本地与云端共用同一套格式）。
// 页面从门面导入，避免直接依赖 services/local 下的实现文件。

export * from '../local/backupFormat'
