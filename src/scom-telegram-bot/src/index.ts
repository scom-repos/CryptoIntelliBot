// import TelegramBot, { EditMessageTextOptions, SendMessageOptions } from "node-telegram-bot-api";
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import Stripe from "stripe";
import { chatWithAI, checkIfUserHasAccessToCommunity, fetchPubkeyFromUsername, initAIMetaData } from './API';
import { WalletPay } from "wallet-pay";
import * as fs from "fs";
import * as path from "path";

const cors = require("@koa/cors");

const CONFIG = require('../config/config.js');

const apiEndpoint = CONFIG.apiEndpoint;
const telegramBotApiToken = CONFIG.telegramBotApiToken;
const paymentProviderToken = CONFIG.paymentProviderToken;

const bot = new Telegraf(telegramBotApiToken);
let replyCache: any = {};

type CreateInvoiceBody = {
    title: string;
    description: string;
    currency: string;
    photoUrl: string;
    payload: string;
    prices: { label: string; amount: number }[];
}

interface ICommunitySubscription {
    start: number;
    end: number;
    currency: string;
    chainId?: string;
    nftAddress?: string;
    nftId?: number;
    txHash?: string;
}

type SubscriptionStatus = {
    hasAccess: boolean;
    subscriptions: ICommunitySubscription[];
    isWhiteListed: boolean;
}



const createInvoiceLink = async (body: CreateInvoiceBody) => {
    const { title, description, currency, photoUrl, payload, prices } = body;
    const telegramInvoice = {
        provider_token: paymentProviderToken!!,
        title,
        description,
        currency,
        photo_url: photoUrl, //TODO: env
        is_flexible: false, //TODO: env
        prices,
        payload: 'invoice_payload',
        need_name: true,
        need_email: true,
        need_phone_number: true,
        need_shipping_address: true
    };

    const link = await bot.telegram.createInvoiceLink(telegramInvoice);
    return link;
}

const checkUserAccess = async (username: string): Promise<SubscriptionStatus> => {
    const pubkey = await fetchPubkeyFromUsername(username);
    if (pubkey) {
        const data: SubscriptionStatus = await checkIfUserHasAccessToCommunity({ creatorId: CONFIG.creatorId, communityId: CONFIG.communityId, pubkey });
        // TODO
        console.log(`[${username}] checkUserAccess result`, data);
        return data;
    }
    else
        throw new Error('Noto account is not associated.');
}

const getSubscribeLink = () => {
    if (CONFIG.communityENS) {
        return `https://ton.noto.fan/#!/n/${CONFIG.communityENS}?subscription=ton`;
    } else {
        return `https://ton.noto.fan/#!/c/${CONFIG.communityId}/${CONFIG.creatorId}?subscription=ton`;
    }
}

bot.start(async (ctx) => {
    const user = ctx.message.from;
    const id = user.id;
    const username = user.username;
    console.log(`[${username}] /start`);
    ctx.reply(`I'm Anna Sings, a singer-songwriter from Canada, here to share my passion for music with you! 🎤💖`);
})

bot.command('subscribe', async (ctx) => {
    let user = ctx.update.message.from;
    try {
        const username = user.username as string;
        console.log(`[${username}] /subscribe`)
        const subscriptionStatus = await checkUserAccess(username);
        const { hasAccess, subscriptions, isWhiteListed } = subscriptionStatus;
        console.log(`[${username}] has access: ${hasAccess}, is white listed: ${isWhiteListed}, subscriptions: `, subscriptions);

        let buttonCaption = 'Subscribe';
        let status = '';
        let responseString = '';

        let startDate, endDate;

        const tonSubscriptions = subscriptions?.filter(item => item.chainId === 'TON');
        if (tonSubscriptions && tonSubscriptions.length > 0) {
            const latestSubscription = tonSubscriptions.sort((v1, v2) => v2.end > v1.end ? 1 : -1)[0];
            startDate = new Date(latestSubscription.start * 1000);
            endDate = new Date(latestSubscription.end * 1000);
            if (latestSubscription.end > +new Date()) {
                status = 'Expired';
                buttonCaption = 'Renew subscription';
            }
            else {
                status = 'Active'
                buttonCaption = 'Extend subscription';
            }
        }
        else if (!hasAccess) {
            status = 'Not subscribed'
            buttonCaption = 'Subscribe'
        }

        responseString += `Subscription status: ${status}\n`;
        if (startDate && endDate) {
            responseString += `Subscription start date: ${startDate.getDate()}/${startDate.getMonth() + 1}/${startDate.getFullYear()} - ${endDate.getDate()}/${endDate.getMonth() + 1}/${endDate.getFullYear()}\n`
        }

        const subscribeLink = getSubscribeLink();
        const subscriptionInlineKeyboardResponse = Markup.inlineKeyboard([
            [Markup.button.webApp(buttonCaption, subscribeLink)]
        ])
        ctx.reply(responseString, subscriptionInlineKeyboardResponse);
    }
    catch (e: any) {
        ctx.reply(`${e.message}`);
    }
})

bot.on("message", async (ctx) => {
    const chatId = ctx.message.chat.id;
    const user = ctx.message.from;
    const username = user.username;
    const messageText = ctx.text || '';
    console.log(`[${username}]: ${messageText}`);
    try {
    await initAIMetaData(chatId);
    }
    catch(e) {
        console.log('e', e)
    }
    if ((ctx.update.message as any).successful_payment !== undefined) {
        ctx.reply('Thank you for your payment.');
    }
    else if (messageText.trim() !== ''){
        // Todo: Add validations for user who has subscribed here.
        chatWithAI(chatId, messageText, ctx);
    }
    // console.log(ctx.message.web_app_data)
    // return ctx.reply(ctx.message.web_app_data.data)
});


bot.on('pre_checkout_query', (ctx) => {
    console.log('precheckout query');
    ctx.telegram.answerPreCheckoutQuery(ctx.preCheckoutQuery.id, true); // Approve payment process
});

bot.catch((err, ctx) => {
    console.error(`Bot encountered an error for ${ctx.updateType}`, err);
});

bot.launch();

console.log('Telegram bot has been started.');

const app = new Koa();
app.use(cors());
app.use(bodyParser());

app.use(async ctx => {
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
            const body: any = ctx.request.body;
            const { chatId, success } = body;
            if (success) {
                Telegraf.reply('Payment successful! Thank you for your purchase.');
            } else {
                Telegraf.reply('Payment failed. Please try again.');
            }
        }
        else if (ctx.request.path === '/invoice') {
            const body: any = ctx.request.body;
            const { title, description, currency, prices, photoUrl } = body;
            const invoiceLink = await createInvoiceLink({ title, description, currency, prices, photoUrl, payload: 'invoice_payload' });
            ctx.body = JSON.stringify({ success: true, data: { invoiceLink } });
        }
        else if (ctx.request.path === '/payment-intent') {
            const body: any = ctx.request.body;
            const stripe = new Stripe('sk_test_51Q60lAP7pMwOSpCLNlbVBSZOIUOaqYVFVWihoOpqVOjOag6hUtOktCBYFudiXkVLiYKRlgZODmILVnr271jm9yQc00ANkHT99O');
            const paymentIntent = await stripe.paymentIntents.create({
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
});

app.listen(3000, () => {
    console.log('Payment gateway server is running on port 3000');
})
