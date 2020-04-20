/**
 * @license
 *  Copyright Baidu Inc. All Rights Reserved.
 *
 *  This source code is licensed under the Apache License, Version 2.0; found in the
 *  LICENSE file in the root directory of this source tree.
 *
 * @file 编辑器统计相关util
 * @author zhengjiaqi01@baidu.com
 */
import {getWebViewContext} from './context';

let lastEditorPvDate: number;
let durationStartTimer: NodeJS.Timeout;
let isFeaturePvStart = true;

interface IFeaturePvData {
	[key: string]: number
}

let featurePvData: IFeaturePvData = {};

interface IFeatureIdMap {
	[key: string]: number
}

const featureIdMap: IFeatureIdMap = {
    'fileTool': 1, // 快速打开文件
    'globalSearch': 2, // 全局搜索
    'globalReplace': 3, // 全局替换
    'px2rpxSuggestion': 4, // px2rpx代码提示
    'px2rpxMenu': 5, // px2rpx菜单
    'px2rpxSelectionMenu': 6, // 选定代码px2rpx菜单
    'gitComparePrev': 7, // git与上一版本比较
    'gitDiffDetails': 8, // git diff详情
    'gitSectionStage': 9, // git 部分暂存
    'gitSectionRevert': 10, // git 部分还原
    'jsApiSuggestions': 11, // js api 提示
    'jsApiSnippetSuggestions': 12, // js api 代码片段提示
    'jsNamespaceSuggestions': 13, // js 命名空间提示
    'jsSubNamespaceSuggestions': 14, // js 子命名空间提示
    'jsGlobalSnippetSuggestions': 15, // js global api代码片段提示
    'swanLabelSuggestions': 16, // swan 标签提示
    'swanParamSuggestions': 17, // swan 标签属性提示
    'swanParamValueSuggestions': 18, // swan 标签属性可选值提示
    'jsonSnippetSuggestions': 19, // json 代码片段提示
    'autoCloseTag': 20, // 自动闭合标签功能
    'autoRenameTag': 21, // 自动重命名标签功能
    'createPage': 22, // 新建页面
    'createComponent': 23, // 新建组件
    'createCloudFunction': 24, // 新建云函数
    'createFile': 25, // 新建文件
    'createDir': 26, // 新建目录
    'rename': 27, // 重命名
    'delete': 28, // 删除
    'revealFinder': 29, // 硬盘打开
    'terminal': 30, // 在终端中打开
    'copyRelativePath': 31, // 复制相对路径
    'copyPath': 32, // 复制路径
    'switchCloudEnv': 33, // 切换云函数环境
    'syncCloudFunction': 34, // 同步云函数
    'uploadCloudFunction': 35, // 上传云函数
    'downCloudFunction': 36, // 下载云函数
    'deployCloudFunction': 37, // 部署云函数
    'closeOtherTabs': 38, // 关闭其他标签页
    'closeRightTabs': 39, // 关闭右侧标签页
    'closeAllTabs': 40, // 关闭所有标签页
    'collapseAll': 41, // 收起所有文件
    'hideFileTree': 42, // 隐藏文件树
    'showFileTree': 43, // 显示文件树
    'mdPreview': 44, // markdown预览
    'mdUpload': 45, // markdown上传
    'openInNewTabTrue': 46, // 打开总是在新标签页打开文件
    'openInNewTabFalse': 47, // 关闭总是在新标签页打开文件
    'minimapTrue': 48, // 打开代码缩略图
    'minimapFalse': 49, // 关闭代码缩略图
    'insertSpacesTrue': 50, // 打开使用空格替代tab
    'insertSpacesFalse': 51, // 关闭使用空格替代tab
    'wordWrapTrue': 52, // 打开自动折行
    'wordWrapFalse': 53, // 关闭自动折行
    'compileSaveTrue': 54, // 打开编译时自动保存
    'compileSaveFalse': 55, // 关闭编译时自动保存
    'autoCreatePage': 56, // 自动创建页面
    'setDebugger': 57, // 设置断点
    'removeDebugger': 58, // 移除断点
    'setDebuggerEnable': 59, // 设置断点可用
    'setDebuggerUnable': 60, // 设置断点不可用
    'editorSetDebugger': 61, // 编辑器设置断点
    'editorRemoveDebugger': 62, // 编辑器移除断点
    'editorSetDebuggerEnable': 63, // 编辑器设置断点可用
    'editorSetDebuggerUnable': 64, // 编辑器设置断点不可用
    'debuggerExecution': 65, // 断点执行
    'pathSuggestions': 66, // 文件路径提示
    'doc': 67 // 查看文档
};

export function editorPv() {
    const curDate = new Date().getDate();
    if (lastEditorPvDate && lastEditorPvDate === curDate) {
        return;
    }
    lastEditorPvDate = curDate;
    const event = getWebViewContext().event;
    event && event.send('editorPv', {});
    event && event.send('report.flow', {
        id: 'editor_editorPv',
        et: 'click',
        sc: 'editor',
        ext: {}
    });
}

function editorUseDurationPause() {
    getWebViewContext().event.send('editorUseDurationPause', {});
}

function editorUseDurationStart() {
    getWebViewContext().event.send('editorUseDurationStart', {});
    clearTimeout(durationStartTimer);
    // 1分钟内无事件暂停计时
    durationStartTimer = setTimeout(() => {
        editorUseDurationPause();
    }, 60 * 1000);
}

function setFeaturePv(type: string) {
    const id = featureIdMap[type] || 0;
    if (featurePvData[id]) {
        featurePvData[id]++;
    }
    else {
        featurePvData[id] = 1;
    }
}

function resetFeaturePvData() {
    featurePvData = {};
    isFeaturePvStart = true;
}

function doSendEditorFeaturePv() {
    getWebViewContext().event.send('editorFeaturePv', featurePvData);
    resetFeaturePvData();
}

function sendEditorFeaturePv() {
    if (isFeaturePvStart) {
        isFeaturePvStart = false;
        // 5分钟上报一次编辑器具体功能打点
        setTimeout(() => {
            doSendEditorFeaturePv();
        }, 5 * 60 * 1000);
    }
}

export function editorFeaturePv(type: string) {
	console.log('---editorFeaturePv:', type)
    setFeaturePv(type);
    sendEditorFeaturePv();
    const event = getWebViewContext().event;
    event && event.send('report.flow', {
        id: `editor_${type}`,
        et: 'click',
        sc: 'editor',
        ext: {}
    });
}


module.exports = {
    editorPv,
    editorUseDurationStart,
    editorUseDurationPause,
    editorFeaturePv,
    doSendEditorFeaturePv,
    resetFeaturePvData
};

