// ─── Node 18 Polyfill ────────────────────────────────────────────────────────
if (typeof File === 'undefined') {
  const { Blob } = require('buffer');
  global.File = class File extends Blob {
    constructor(chunks, filename, opts = {}) {
      super(chunks, opts);
      this.name         = filename;
      this.lastModified = opts.lastModified ?? Date.now();
    }
  };
}

/**
 * Discord Selfbot - Auto /bump
 * Automatically executes the /bump command every 2 hours using a user token.
 *
 * Uses:
 *  - discord.js-selfbot-v13  → user token support
 *  - dotenv                  → environment variable loading
 *  - node-schedule           → cron-based scheduling
 */

// ─── Imports ───────────────────────────────────────────────────────────────
const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── File Logging Helper ───────────────────────────────────────────────────
function logToFile(message) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const timestamp = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} UTC`;

  const logLine = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'bump.log'), logLine, 'utf8');
  } catch (err) {
    // Ignore logging errors to prevent crashing
  }
}

// ─── Environment Variables ──────────────────────────────────────────────────
const USER_TOKEN  = process.env.USER_TOKEN;
const GUILD_ID    = process.env.GUILD_ID;
const CHANNEL_ID  = process.env.CHANNEL_ID;

// Validate that all required env vars are present before doing anything else
if (!USER_TOKEN || !GUILD_ID || !CHANNEL_ID) {
  const msg1 = '❌ Missing environment variables. Please check your .env file.';
  const msg2 = '   Required: USER_TOKEN, GUILD_ID, CHANNEL_ID';
  console.error(msg1);
  logToFile(msg1);
  console.error(msg2);
  logToFile(msg2);
  process.exit(1);
}

// ─── Discord Client ─────────────────────────────────────────────────────────
const client = new Client({
  checkUpdate: false, // suppress update-check noise in the console
});

// ─── Helper: Formatted UTC timestamp ────────────────────────────────────────
function utcTimestamp() {
  const now = new Date();
  const hh  = String(now.getUTCHours()).padStart(2, '0');
  const mm  = String(now.getUTCMinutes()).padStart(2, '0');
  const ss  = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} UTC`;
}

// ─── Helper: Format date to UTC timestamp ───────────────────────────────────
function formatUtcTime(date) {
  const hh  = String(date.getUTCHours()).padStart(2, '0');
  const mm  = String(date.getUTCMinutes()).padStart(2, '0');
  const ss  = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} UTC`;
}

// ─── Helper: Global timeout state and scheduler ─────────────────────────────
let bumpTimeout = null;

function scheduleNextBump(delayMs) {
  if (bumpTimeout) {
    clearTimeout(bumpTimeout);
  }
  bumpTimeout = setTimeout(triggerBumpWithDelay, delayMs);
}

// ─── Helper: Random Delay Trigger ───────────────────────────────────────────
function triggerBumpWithDelay() {
  const delayMs = Math.floor(Math.random() * (300000 - 60000 + 1)) + 60000;
  const totalSeconds = Math.floor(delayMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const waitMsg = `⏳ ${utcTimestamp()} - Waiting ${minutes}m ${seconds}s before bumping...`;
  console.log(waitMsg);
  logToFile(waitMsg);

  bumpTimeout = setTimeout(executeBump, delayMs);
}

// ─── Core Bump Function ──────────────────────────────────────────────────────
async function executeBump() {
  const timestamp = utcTimestamp();
  const attemptMsg = `🚀 [${timestamp}] - Attempting to send /bump slash command...`;
  console.log(attemptMsg);
  logToFile(attemptMsg);

  try {
    const channel = client.channels.cache.get(CHANNEL_ID);

    if (!channel) {
      const errMsg = `❌ [${timestamp}] - /bump failed: Channel not found (ID: ${CHANNEL_ID})`;
      console.error(errMsg);
      logToFile(errMsg);
      
      const retryTime = new Date(Date.now() + 30 * 60 * 1000);
      const retryMsg = `   Retrying in 30 minutes (at ${formatUtcTime(retryTime)})...`;
      console.error(retryMsg);
      logToFile(retryMsg);
      
      scheduleNextBump(30 * 60 * 1000);
      return;
    }

    // Set up response collector before sending the slash command
    const filter = message => {
      return (
        message.author.id === '302050872383242240' &&
        message.channel.id === CHANNEL_ID &&
        message.embeds &&
        message.embeds.length > 0
      );
    };

    const collectorPromise = channel.awaitMessages({
      filter,
      max: 1,
      time: 15000,
      errors: ['time']
    });

    // Send the slash command interaction
    try {
      await channel.sendSlash('302050872383242240', 'bump');
    } catch (slashError) {
      // Even if sendSlash rejects (e.g. because of the 5s interaction response promise timeout),
      // the request might have gone through successfully. We log it and wait for Disboard's response.
      const warnMsg = `⚠️ [${timestamp}] - Interaction warning / error: ${slashError?.message || slashError}`;
      console.warn(warnMsg);
      logToFile(warnMsg);
    }

    // Await Disboard's response
    try {
      const collected = await collectorPromise;
      const responseMsg = collected.first();
      const embed = responseMsg.embeds[0];
      const title = embed.title || '';
      const description = embed.description || '';
      const textToCheck = `${title} ${description}`;

      if (/bump done|bumped/i.test(textToCheck)) {
        const nextTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const successMsg = `✅ [${utcTimestamp()}] - Bump success! Next bump scheduled at: ${formatUtcTime(nextTime)}`;
        console.log(successMsg);
        logToFile(successMsg);
        
        scheduleNextBump(2 * 60 * 60 * 1000);
      } else if (/wait|you need to wait/i.test(textToCheck)) {
        const retryTime = new Date(Date.now() + 30 * 60 * 1000);
        const cdMsg = `⚠️ [${utcTimestamp()}] - Cooldown detected. Retrying in 30 minutes at: ${formatUtcTime(retryTime)}`;
        console.log(cdMsg);
        logToFile(cdMsg);
        
        const embedMsg = `   Embed message: "${textToCheck.replace(/\n/g, ' ').trim()}"`;
        console.log(embedMsg);
        logToFile(embedMsg);
        
        scheduleNextBump(30 * 60 * 1000);
      } else {
        const retryTime = new Date(Date.now() + 30 * 60 * 1000);
        const unexpectedMsg = `⚠️ [${utcTimestamp()}] - Unexpected response from Disboard. Retrying in 30 minutes at: ${formatUtcTime(retryTime)}`;
        console.log(unexpectedMsg);
        logToFile(unexpectedMsg);
        
        const embedMsg = `   Embed message: "${textToCheck.replace(/\n/g, ' ').trim()}"`;
        console.log(embedMsg);
        logToFile(embedMsg);
        
        scheduleNextBump(30 * 60 * 1000);
      }
    } catch (collectorError) {
      // TIMEOUT
      const retryTime = new Date(Date.now() + 30 * 60 * 1000);
      const timeoutMsg = `❌ [${utcTimestamp()}] - Timeout: No response from Disboard within 15 seconds. Retrying in 30 minutes at: ${formatUtcTime(retryTime)}`;
      console.log(timeoutMsg);
      logToFile(timeoutMsg);
      
      scheduleNextBump(30 * 60 * 1000);
    }

  } catch (error) {
    const reason = error?.message || String(error);
    const retryTime = new Date(Date.now() + 30 * 60 * 1000);
    const errorMsg = `❌ [${utcTimestamp()}] - General error during bump execution: ${reason}`;
    console.error(errorMsg);
    logToFile(errorMsg);
    
    const retryMsg = `   Retrying in 30 minutes at: ${formatUtcTime(retryTime)}`;
    console.error(retryMsg);
    logToFile(retryMsg);
    
    scheduleNextBump(30 * 60 * 1000);
  }
}

// ─── Ready Event ─────────────────────────────────────────────────────────────
let isStarted = false;

client.on('ready', () => {
  const loginMsg = `✅ Logged in as: ${client.user.tag}`;
  console.log(loginMsg);
  logToFile(loginMsg);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    const guildMsg = `📍 Guild: ${guild.name}`;
    console.log(guildMsg);
    logToFile(guildMsg);
  } else {
    const guildWarn = `⚠️  Guild not found in cache (ID: ${GUILD_ID}). Check your GUILD_ID.`;
    console.warn(guildWarn);
    logToFile(guildWarn);
  }

  const channel = client.channels.cache.get(CHANNEL_ID);
  if (channel) {
    const channelMsg = `📍 Channel: #${channel.name}`;
    console.log(channelMsg);
    logToFile(channelMsg);
  } else {
    const channelWarn = `⚠️  Channel not found in cache (ID: ${CHANNEL_ID}). Check your CHANNEL_ID.`;
    console.warn(channelWarn);
    logToFile(channelWarn);
  }

  if (!isStarted) {
    isStarted = true;
    triggerBumpWithDelay();
  }

  process.send?.('ready');
});

// ─── Global Error Handlers ────────────────────────────────────────────────────

client.on('error', (error) => {
  const msg = error?.message || String(error);
  if (msg.includes('401') || msg.toLowerCase().includes('invalid token')) {
    const tokenErr = '❌ Invalid token. Check USER_TOKEN in your .env file.';
    console.error(tokenErr);
    logToFile(tokenErr);
    process.exit(1);
  }
  const clientErr = `❌ Client error: ${msg}`;
  console.error(clientErr);
  logToFile(clientErr);
});

// Catch unhandled promise rejections so the process doesn't crash silently
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (msg.includes('401') || msg.toLowerCase().includes('invalid token')) {
    const tokenErr = '❌ Invalid token. Check USER_TOKEN in your .env file.';
    console.error(tokenErr);
    logToFile(tokenErr);
    process.exit(1);
  }
  const unhandledErr = `❌ Unhandled rejection: ${msg}`;
  console.error(unhandledErr);
  logToFile(unhandledErr);
});

// Graceful shutdown on Ctrl+C / SIGINT
process.on('SIGINT', () => {
  const shutdownMsg = '\n👋 Shutting down selfbot...';
  console.log(shutdownMsg);
  logToFile(shutdownMsg);
  client.destroy();
  process.exit(0);
});

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(USER_TOKEN);
