"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWidgetEmbedUrl = exports.containsNone = void 0;
const CONFIG = require('../config/config');
const containsNone = (obj) => {
    if (typeof obj === "object" && obj !== null) {
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                if (obj[key] === "none") {
                    return true;
                }
                if (typeof obj[key] === "object" && containsNone(obj[key])) {
                    return true;
                }
            }
        }
    }
    return false;
};
exports.containsNone = containsNone;
const getWidgetEmbedUrl = (module, data) => {
    if (module) {
        const widgetData = {
            module: {
                name: module
            },
            properties: Object.assign({}, data),
            modifiedTime: Date.now()
        };
        const encodedWidgetDataString = encodeURIComponent(Buffer.from(JSON.stringify(widgetData)).toString('base64'));
        const moduleName = module.slice(1);
        return `${CONFIG.widgetUrl}/#!/${moduleName}/${encodedWidgetDataString}`;
    }
    return '';
};
exports.getWidgetEmbedUrl = getWidgetEmbedUrl;
