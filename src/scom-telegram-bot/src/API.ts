import * as path from "path";
import * as fs from "fs";
import { containsNone, getWidgetEmbedUrl } from "./utils";
import { swapWidgetData } from "./widgetData";

const CONFIG = require('../config/config.js');
const gatekeeperUrl = CONFIG.publicIndexingRelay;

interface ICommunitySubscription {
  start: number;
  end: number;
  currency: string;
  chainId?: string;
  nftAddress?: string;
  nftId?: number;
  txHash?: string;
}

type ResolverResponse = {
  intention: string,
  details: any,
  follow_up_questions: string
}

type RAGResponse = {
  results: any,
  references: any,
  response: any
}


async function fetchPubkeyFromUsername(username: string) {
  let pubkey: string = '';
  try {
    let response = await fetch(`${gatekeeperUrl}/fetch-user-profile-detail`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ telegramAccount: username })
    })
    let result = await response.json();
    const requestId = result?.requestId;
    if (requestId) {
      const pollFunction = async () => {
        const pollRequestInit = {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }
        const pollResponse = await fetch(`${gatekeeperUrl}/poll/${requestId}`, pollRequestInit);
        const pollResult = await pollResponse.json();
        return pollResult;
      }
      const stopPolling = (pollResult: any) => {
        return !!pollResult?.data;
      }
      const pollResult = await exponentialBackoffRetry(
        pollFunction,
        10,
        200,
        10000,
        2,
        stopPolling
      );
      result = pollResult.data;
    }
    if (result?.events?.length) {
      const event = result.events.find((v: any) => v.kind === 0);
      pubkey = event?.pubkey;
    }
  } catch (error) {
    console.log('fetchUserProfile', error);
  }
  return pubkey;
}

async function checkIfUserHasAccessToCommunity(params: { creatorId: string, communityId: string, pubkey: string, walletAddresses?: string[] }) {
  let data: {
    hasAccess: boolean,
    subscriptions: ICommunitySubscription[],
    isWhiteListed: boolean
  } = { hasAccess: false, subscriptions: [], isWhiteListed: false };
  try {
    const { creatorId, communityId, pubkey, walletAddresses } = params;
    const bodyData = {
      creatorId,
      communityId,
      pubkey,
      walletAddresses: walletAddresses || []
    };
    const response = await fetch(`${gatekeeperUrl}/communities/check-user-access`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyData)
    });
    const result = await response.json();
    if (result.success) {
      data = result.data;
    }
  } catch (error) {
    console.log('checkIfUserHasAccessToCommunity', error)
  }
  return data;
}

async function exponentialBackoffRetry<T>(
  fn: () => Promise<T>, // Function to retry
  retries: number, // Maximum number of retries
  delay: number, // Initial delay duration in milliseconds
  maxDelay: number, // Maximum delay duration in milliseconds
  factor: number, // Exponential backoff factor
  stopCondition: (data: T) => boolean = () => true // Stop condition
): Promise<T> {
  let currentDelay = delay;

  for (let i = 0; i < retries; i++) {
    try {
      const data = await fn();
      if (stopCondition(data)) {
        return data;
      }
      else {
        console.log(`Attempt ${i + 1} failed. Retrying in ${currentDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay = Math.min(maxDelay, currentDelay * factor);
      }
    }
    catch (error) {
      console.error('error', error);
      console.log(`Attempt ${i + 1} failed. Retrying in ${currentDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(maxDelay, currentDelay * factor);
    }
  }
  throw new Error(`Failed after ${retries} retries`);
}

const initAIMetaData = async (chatId: number) => {
  const response = await fetch("http://web:8000/rag/generate_metadata_embeddings/", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ chat_id: chatId.toString(), link: "https://storage.decom.app/ipfs/bafybeic24si2wrs3z3des5pucvxjkrycmtrviwtqcnt24wxzujlsb465by/Anna", is_public: "true" })
  }
  );
  // console.log('initAIMetaData response', response);
}

const chatWithAI = async (chatId: number, messageText: string, ctx: any) => {
  const chat_id = chatId.toString();
  const user = ctx.message.from;
  const username = user.username;
  try {

    // Load intention schema from a local file using Node's fs module
    const intentionSchemaPath = path.join(process.cwd(), 'config', 'intention_schema.json');
    const intention_schema = fs.readFileSync(intentionSchemaPath, 'utf8');
    const parsedIntentionSchema = JSON.parse(intention_schema);  // Parse it into a JSON object

    // Call the resolver API with the fetched intention schema
    const resolverResponse = await fetch("http://web:8000/resolver/intention_resolver/", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'  // Change the content type to JSON
      },
      body: JSON.stringify({
        chat_id: chat_id,              // chat_id is sent as part of the JSON body
        query: messageText,            // query is sent as part of the JSON body
        intention_schema: parsedIntentionSchema,      // Use the loaded intention schema here
      })
    });

    if (resolverResponse.ok) {
      const data = await resolverResponse.json() as ResolverResponse;
      if (data.intention === 'none') {
        const ragResponse = await fetch("http://web:8000/rag/retrieve_augment_generate/", {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'  // Change the content type
          },
          body: new URLSearchParams({
            chat_id: chat_id,
            query: messageText
          }).toString()  // Send the URL-encoded body
        });
        if (ragResponse.ok) {
          const ragData = await ragResponse.json() as RAGResponse;
          const refItem = ragData.references.map((item: { title: string; similarity: number }) => `${item.title} (similarity: ${item.similarity})`).join('\n');
          const ref = refItem ? `References:\n${refItem}` : '';
          console.log(`[${username}] ${messageText}. Response: ${ragData.response}\n\n${ref}`)
          ctx.reply(`${ragData.response}\n\n${ref}`);
        } else {
          const errorText = await ragResponse.text();
          // ctx.reply(`Error fetching RAG response. Status: ${ragResponse.status}. Response: ${errorText}`);
          console.log(`[${username}] Error fetching RAG response. Status: ${ragResponse.status}. Response: ${errorText}`);
        }
      } else {
        if (containsNone(data.details)) {
          console.log(`[${username}] ${messageText}. Response: ${data.follow_up_questions}`)
          ctx.reply(data.follow_up_questions);
        } else {
          if (data.intention === 'swap_token') {
            console.log(`[${username}] Click the button to swap token`);
            ctx.reply("Click the button below to swap token:", {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "Swap",
                      web_app: { url: getWidgetEmbedUrl(swapWidgetData.module.name, swapWidgetData.properties) },  // The URL you want to open as an embedded widget
                    },
                  ],
                ],
              },
            });
          }
          else if (data.intention === 'fetch_file_from_storage') {
            const ragResponse = await fetch("http://web:8000/rag/retrieve_meta_data/", {
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
              const ragData = await ragResponse.json() as RAGResponse;
              if (ragData.results && ragData.results.length > 0) {
                await ctx.reply("Fetching image from storage...");
                for (const result of ragData.results) {
                  if (result.url.endsWith('.jpeg') || result.url.endsWith('.jpg') || result.url.endsWith('.png')) {
                    console.log(`[${username}] ${messageText}. Response: photoUrl(${result.url}), caption: ${result.description}`)
                    ctx.replyWithPhoto(result.url, {
                      caption: `${result.description}`
                    });
                  }
                  else if (result.url.endsWith('.mp3')) {
                    console.log(`[${username}] ${messageText}. Response: audioUrl(${result.url}), caption: ${result.description}`)
                    ctx.replyWithAudio(result.url, { caption: result.description })
                  }
                }
              } else {
                console.log(`[${username}] ${messageText}. Response: No image was found.`);
                ctx.reply("No image was found.");
              }
            } else {
              const errorText = await ragResponse.text();
              // ctx.reply(`Error fetching metadata. Status: ${ragResponse.status}. Response: ${errorText}`);
              console.log(`[${username}] ${messageText}. Response: Error fetching metadata. Status: ${ragResponse.status}. Response: ${errorText}`);
            }
          } else {
            // ctx.reply(`Intent detected but no action required. Here is the JSON response:\n${JSON.stringify(data, null, 2)}`);
            console.log(`[${username}] ${messageText}. Response: Intent detected but no action required. Here is the JSON response:\n${JSON.stringify(data, null, 2)}`);
          }
        }
      }
    } else {
      const errorText = await resolverResponse.text();
      console.log(`[${username}] ${messageText}. Response: Error fetching API response. Status: ${resolverResponse.status}. Response: ${errorText}`)
      // ctx.reply(`Error fetching API response. Status: ${resolverResponse.status}. Response: ${errorText}`);
      console.log(`Error fetching API response. Status: ${resolverResponse.status}. Response: ${errorText}`)
    }
  } catch (error) {
    // ctx.reply(`Failed to contact API: ${(error as Error).message}`);
    console.log(`[${username}] ${messageText}. `, 'API Error: ', error)
    console.error('API Error: ', error);
  }
};

export {
  fetchPubkeyFromUsername,
  checkIfUserHasAccessToCommunity,
  chatWithAI,
  initAIMetaData
}