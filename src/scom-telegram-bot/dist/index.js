"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// import TelegramBot, { EditMessageTextOptions, SendMessageOptions } from "node-telegram-bot-api";
const koa_1 = __importDefault(require("koa"));
const koa_bodyparser_1 = __importDefault(require("koa-bodyparser"));
const telegraf_1 = require("telegraf");
const stripe_1 = __importDefault(require("stripe"));
const API_1 = require("./API");
const cors = require("@koa/cors");
const CONFIG = require('../config/config.js');
const apiEndpoint = CONFIG.apiEndpoint;
const telegramBotApiToken = CONFIG.telegramBotApiToken;
const paymentProviderToken = CONFIG.paymentProviderToken;
const bot = new telegraf_1.Telegraf(telegramBotApiToken);
let replyCache = {};
const createInvoiceLink = (body) => __awaiter(void 0, void 0, void 0, function* () {
    const { title, description, currency, photoUrl, payload, prices } = body;
    const telegramInvoice = {
        provider_token: paymentProviderToken,
        title,
        description,
        currency,
        photo_url: photoUrl,
        is_flexible: false,
        prices,
        payload: 'invoice_payload',
        need_name: true,
        need_email: true,
        need_phone_number: true,
        need_shipping_address: true
    };
    const link = yield bot.telegram.createInvoiceLink(telegramInvoice);
    return link;
});
const checkUserAccess = (username) => __awaiter(void 0, void 0, void 0, function* () {
    const pubkey = yield (0, API_1.fetchPubkeyFromUsername)(username);
    if (pubkey) {
        const data = yield (0, API_1.checkIfUserHasAccessToCommunity)({ creatorId: CONFIG.creatorId, communityId: CONFIG.communityId, pubkey });
        // TODO
        console.log(`[${username}] checkUserAccess result`, data);
        return data;
    }
    else
        throw new Error('Noto account is not associated.');
});
const getSubscribeLink = () => {
    if (CONFIG.communityENS) {
        return `https://ton.noto.fan/#!/n/${CONFIG.communityENS}?subscription=ton`;
    }
    else {
        return `https://ton.noto.fan/#!/c/${CONFIG.communityId}/${CONFIG.creatorId}?subscription=ton`;
    }
};
bot.start((ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const user = ctx.message.from;
    const id = user.id;
    const username = user.username;
    console.log(`[${username}] /start`);
    ctx.reply(`I'm Anna Sings, a singer-songwriter from Canada, here to share my passion for music with you! 🎤💖`);
}));
bot.command('subscribe', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    let user = ctx.update.message.from;
    try {
        const username = user.username;
        console.log(`[${username}] /subscribe`);
        const subscriptionStatus = yield checkUserAccess(username);
        const { hasAccess, subscriptions, isWhiteListed } = subscriptionStatus;
        console.log(`[${username}] has access: ${hasAccess}, is white listed: ${isWhiteListed}, subscriptions: `, subscriptions);
        let buttonCaption = 'Subscribe';
        let status = '';
        let responseString = '';
        let startDate, endDate;
        const tonSubscriptions = subscriptions === null || subscriptions === void 0 ? void 0 : subscriptions.filter(item => item.chainId === 'TON');
        if (tonSubscriptions && tonSubscriptions.length > 0) {
            const latestSubscription = tonSubscriptions.sort((v1, v2) => v2.end > v1.end ? 1 : -1)[0];
            startDate = new Date(latestSubscription.start * 1000);
            endDate = new Date(latestSubscription.end * 1000);
            if (latestSubscription.end > +new Date()) {
                status = 'Expired';
                buttonCaption = 'Renew subscription';
            }
            else {
                status = 'Active';
                buttonCaption = 'Extend subscription';
            }
        }
        else if (!hasAccess) {
            status = 'Not subscribed';
            buttonCaption = 'Subscribe';
        }
        responseString += `Subscription status: ${status}\n`;
        if (startDate && endDate) {
            responseString += `Subscription start date: ${startDate.getDate()}/${startDate.getMonth() + 1}/${startDate.getFullYear()} - ${endDate.getDate()}/${endDate.getMonth() + 1}/${endDate.getFullYear()}\n`;
        }
        const subscribeLink = getSubscribeLink();
        const subscriptionInlineKeyboardResponse = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.webApp(buttonCaption, subscribeLink)]
        ]);
        ctx.reply(responseString, subscriptionInlineKeyboardResponse);
    }
    catch (e) {
        ctx.reply(`${e.message}`);
    }
}));
bot.on("message", (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    const chatId = ctx.message.chat.id;
    const user = ctx.message.from;
    const username = user.username;
    const messageText = ctx.text || '';
    console.log(`[${username}]: ${messageText}`);
    try {
        yield (0, API_1.initAIMetaData)(chatId);
    }
    catch (e) {
        console.log('e', e);
    }
    if (ctx.update.message.successful_payment !== undefined) {
        ctx.reply('Thank you for your payment.');
    }
    else if (messageText.trim() !== '') {
        // Todo: Add validations for user who has subscribed here.
        (0, API_1.chatWithAI)(chatId, messageText, ctx);
    }
    // console.log(ctx.message.web_app_data)
    // return ctx.reply(ctx.message.web_app_data.data)
}));
bot.on('pre_checkout_query', (ctx) => {
    console.log('precheckout query');
    ctx.telegram.answerPreCheckoutQuery(ctx.preCheckoutQuery.id, true); // Approve payment process
});
bot.catch((err, ctx) => {
    console.error(`Bot encountered an error for ${ctx.updateType}`, err);
});
bot.launch();
console.log('Telegram bot has been started.');
const app = new koa_1.default();
app.use(cors());
app.use((0, koa_bodyparser_1.default)());
app.use((ctx) => __awaiter(void 0, void 0, void 0, function* () {
    if (ctx.request.method === 'GET') {
        if (ctx.request.path === '/payment-success') {
            ctx.body = 'Payment successful! Thank you for your purchase.';
        }
        else if (ctx.request.path === '/payment-failure') {
            ctx.body = 'Payment failed. Please try again.';
        }
    }
    else if (ctx.request.method === 'POST') {
        if (ctx.request.path === '/payment/success') {
            const body = ctx.request.body;
            const { chatId, success } = body;
            if (success) {
                telegraf_1.Telegraf.reply('Payment successful! Thank you for your purchase.');
            }
            else {
                telegraf_1.Telegraf.reply('Payment failed. Please try again.');
            }
        }
        else if (ctx.request.path === '/invoice') {
            const body = ctx.request.body;
            const { title, description, currency, prices, photoUrl } = body;
            const invoiceLink = yield createInvoiceLink({ title, description, currency, prices, photoUrl, payload: 'invoice_payload' });
            ctx.body = JSON.stringify({ success: true, data: { invoiceLink } });
        }
        else if (ctx.request.path === '/payment-intent') {
            const body = ctx.request.body;
            const stripe = new stripe_1.default('sk_test_51Q60lAP7pMwOSpCLNlbVBSZOIUOaqYVFVWihoOpqVOjOag6hUtOktCBYFudiXkVLiYKRlgZODmILVnr271jm9yQc00ANkHT99O');
            const paymentIntent = yield stripe.paymentIntents.create({
                amount: 100000,
                currency: 'usd'
            });
            ctx.body = JSON.stringify({
                success: true,
                data: {
                    clientSecret: paymentIntent.client_secret
                }
            });
        }
    }
}));
app.listen(3000, () => {
    console.log('Payment gateway server is running on port 3000');
});
