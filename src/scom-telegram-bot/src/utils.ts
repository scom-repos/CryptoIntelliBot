const CONFIG = require('../config/config');

const containsNone = (obj: any): boolean => {
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
}

const getWidgetEmbedUrl = (module: string, data: any) => {
    if (module) {
        const widgetData = {
            module: {
                name: module
            },
            properties: { ...data },
            modifiedTime: Date.now()
        };
        const encodedWidgetDataString = encodeURIComponent(
            Buffer.from(JSON.stringify(widgetData)).toString('base64')
        );
        const moduleName = module.slice(1);
        return `${CONFIG.widgetUrl}/#!/${moduleName}/${encodedWidgetDataString}`;
    }
    return '';
}

export { 
    containsNone, 
    getWidgetEmbedUrl 
};