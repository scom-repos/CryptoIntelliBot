"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAIMetaData = exports.chatWithAI = exports.checkIfUserHasAccessToCommunity = exports.fetchPubkeyFromUsername = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const utils_1 = require("./utils");
const widgetData_1 = require("./widgetData");
const CONFIG = require('../config/config.js');
const gatekeeperUrl = CONFIG.publicIndexingRelay;
function fetchPubkeyFromUsername(username) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        let pubkey = '';
        try {
            let response = yield fetch(`${gatekeeperUrl}/fetch-user-profile-detail`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ telegramAccount: username })
            });
            let result = yield response.json();
            const requestId = result === null || result === void 0 ? void 0 : result.requestId;
            if (requestId) {
                const pollFunction = () => __awaiter(this, void 0, void 0, function* () {
                    const pollRequestInit = {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    };
                    const pollResponse = yield fetch(`${gatekeeperUrl}/poll/${requestId}`, pollRequestInit);
                    const pollResult = yield pollResponse.json();
                    return pollResult;
                });
                const stopPolling = (pollResult) => {
                    return !!(pollResult === null || pollResult === void 0 ? void 0 : pollResult.data);
                };
                const pollResult = yield exponentialBackoffRetry(pollFunction, 10, 200, 10000, 2, stopPolling);
                result = pollResult.data;
            }
            if ((_a = result === null || result === void 0 ? void 0 : result.events) === null || _a === void 0 ? void 0 : _a.length) {
                const event = result.events.find((v) => v.kind === 0);
                pubkey = event === null || event === void 0 ? void 0 : event.pubkey;
            }
        }
        catch (error) {
            console.log('fetchUserProfile', error);
        }
        return pubkey;
    });
}
exports.fetchPubkeyFromUsername = fetchPubkeyFromUsername;
function checkIfUserHasAccessToCommunity(params) {
    return __awaiter(this, void 0, void 0, function* () {
        let data = { hasAccess: false, subscriptions: [], isWhiteListed: false };
        try {
            const { creatorId, communityId, pubkey, walletAddresses } = params;
            const bodyData = {
                creatorId,
                communityId,
                pubkey,
                walletAddresses: walletAddresses || []
            };
            const response = yield fetch(`${gatekeeperUrl}/communities/check-user-access`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(bodyData)
            });
            const result = yield response.json();
            if (result.success) {
                data = result.data;
            }
        }
        catch (error) {
            console.log('checkIfUserHasAccessToCommunity', error);
        }
        return data;
    });
}
exports.checkIfUserHasAccessToCommunity = checkIfUserHasAccessToCommunity;
function exponentialBackoffRetry(fn, // Function to retry
retries, // Maximum number of retries
delay, // Initial delay duration in milliseconds
maxDelay, // Maximum delay duration in milliseconds
factor, // Exponential backoff factor
stopCondition = () => true // Stop condition
) {
    return __awaiter(this, void 0, void 0, function* () {
        let currentDelay = delay;
        for (let i = 0; i < retries; i++) {
            try {
                const data = yield fn();
                if (stopCondition(data)) {
                    return data;
                }
                else {
                    console.log(`Attempt ${i + 1} failed. Retrying in ${currentDelay}ms...`);
                    yield new Promise(resolve => setTimeout(resolve, currentDelay));
                    currentDelay = Math.min(maxDelay, currentDelay * factor);
                }
            }
            catch (error) {
                console.error('error', error);
                console.log(`Attempt ${i + 1} failed. Retrying in ${currentDelay}ms...`);
                yield new Promise(resolve => setTimeout(resolve, currentDelay));
                currentDelay = Math.min(maxDelay, currentDelay * factor);
            }
        }
        throw new Error(`Failed after ${retries} retries`);
    });
}
const initAIMetaData = (chatId) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield fetch("http://web:8000/rag/generate_metadata_embeddings/", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ chat_id: chatId.toString(), link: "https://storage.decom.app/ipfs/bafybeic24si2wrs3z3des5pucvxjkrycmtrviwtqcnt24wxzujlsb465by/Anna", is_public: "true" })
    });
    // console.log('initAIMetaData response', response);
});
exports.initAIMetaData = initAIMetaData;
const chatWithAI = (chatId, messageText, ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const chat_id = chatId.toString();
    const user = ctx.message.from;
    const username = user.username;
    try {
        // Load intention schema from a local file using Node's fs module
        const intentionSchemaPath = path.join(process.cwd(), 'config', 'intention_schema.json');
        const intention_schema = fs.readFileSync(intentionSchemaPath, 'utf8');
        const parsedIntentionSchema = JSON.parse(intention_schema); // Parse it into a JSON object
        // Call the resolver API with the fetched intention schema
        const resolverResponse = yield fetch("http://web:8000/resolver/intention_resolver/", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json' // Change the content type to JSON
            },
            body: JSON.stringify({
                chat_id: chat_id,
                query: messageText,
                intention_schema: parsedIntentionSchema, // Use the loaded intention schema here
            })
        });
        if (resolverResponse.ok) {
            const data = yield resolverResponse.json();
            if (data.intention === 'none') {
                const ragResponse = yield fetch("http://web:8000/rag/retrieve_augment_generate/", {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded' // Change the content type
                    },
                    body: new URLSearchParams({
                        chat_id: chat_id,
                        query: messageText
                    }).toString() // Send the URL-encoded body
                });
                if (ragResponse.ok) {
                    const ragData = yield ragResponse.json();
                    const refItem = ragData.references.map((item) => `${item.title} (similarity: ${item.similarity})`).join('\n');
                    const ref = refItem ? `References:\n${refItem}` : '';
                    console.log(`[${username}] ${messageText}. Response: ${ragData.response}\n\n${ref}`);
                    ctx.reply(`${ragData.response}\n\n${ref}`);
                }
                else {
                    const errorText = yield ragResponse.text();
                    // ctx.reply(`Error fetching RAG response. Status: ${ragResponse.status}. Response: ${errorText}`);
                    console.log(`[${username}] Error fetching RAG response. Status: ${ragResponse.status}. Response: ${errorText}`);
                }
            }
            else {
                if ((0, utils_1.containsNone)(data.details)) {
                    console.log(`[${username}] ${messageText}. Response: ${data.follow_up_questions}`);
                    ctx.reply(data.follow_up_questions);
                }
                else {
                    if (data.intention === 'swap_token') {
                        console.log(`[${username}] Click the button to swap token`);
                        ctx.reply("Click the button below to swap token:", {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: "Swap",
                                            web_app: { url: (0, utils_1.getWidgetEmbedUrl)(widgetData_1.swapWidgetData.module.name, widgetData_1.swapWidgetData.properties) }, // The URL you want to open as an embedded widget
                                        },
                                    ],
                                ],
                            },
                        });
                    }
                    else if (data.intention === 'fetch_file_from_storage') {
                        const ragResponse = yield fetch("http://web:8000/rag/retrieve_meta_data/", {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body: new URLSearchParams({
                                chat_id: chat_id,
                                query: messageText
                            }).toString()
                        });
                        if (ragResponse.ok) {
                            const ragData = yield ragResponse.json();
                            if (ragData.results && ragData.results.length > 0) {
                                yield ctx.reply("Fetching image from storage...");
                                for (const result of ragData.results) {
                                    if (result.url.endsWith('.jpeg') || result.url.endsWith('.jpg') || result.url.endsWith('.png')) {
                                        console.log(`[${username}] ${messageText}. Response: photoUrl(${result.url}), caption: ${result.description}`);
                                        ctx.replyWithPhoto(result.url, {
                                            caption: `${result.description}`
                                        });
                                    }
                                    else if (result.url.endsWith('.mp3')) {
                                        console.log(`[${username}] ${messageText}. Response: audioUrl(${result.url}), caption: ${result.description}`);
                                        ctx.replyWithAudio(result.url, { caption: result.description });
                                    }
                                }
                            }
                            else {
                                console.log(`[${username}] ${messageText}. Response: No image was found.`);
                                ctx.reply("No image was found.");
                            }
                        }
                        else {
                            const errorText = yield ragResponse.text();
                            // ctx.reply(`Error fetching metadata. Status: ${ragResponse.status}. Response: ${errorText}`);
                            console.log(`[${username}] ${messageText}. Response: Error fetching metadata. Status: ${ragResponse.status}. Response: ${errorText}`);
                        }
                    }
                    else {
                        // ctx.reply(`Intent detected but no action required. Here is the JSON response:\n${JSON.stringify(data, null, 2)}`);
                        console.log(`[${username}] ${messageText}. Response: Intent detected but no action required. Here is the JSON response:\n${JSON.stringify(data, null, 2)}`);
                    }
                }
            }
        }
        else {
            const errorText = yield resolverResponse.text();
            console.log(`[${username}] ${messageText}. Response: Error fetching API response. Status: ${resolverResponse.status}. Response: ${errorText}`);
            // ctx.reply(`Error fetching API response. Status: ${resolverResponse.status}. Response: ${errorText}`);
            console.log(`Error fetching API response. Status: ${resolverResponse.status}. Response: ${errorText}`);
        }
    }
    catch (error) {
        // ctx.reply(`Failed to contact API: ${(error as Error).message}`);
        console.log(`[${username}] ${messageText}. `, 'API Error: ', error);
        console.error('API Error: ', error);
    }
});
exports.chatWithAI = chatWithAI;
