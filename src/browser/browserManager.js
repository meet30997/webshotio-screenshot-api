import puppeteer from 'puppeteer';
import { setTimeout as delay } from 'node:timers/promises';

function createTimeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  error.statusCode = 504;
  error.code = 'UPSTREAM_TIMEOUT';
  return error;
}

function withTimeout(promise, timeoutMs, message) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(createTimeoutError(message));
      }, timeoutMs);
      timer.unref();
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export class BrowserManager {
  constructor({ logger, launchArgs, headless = true }) {
    this.logger = logger;
    this.launchArgs = launchArgs;
    this.headless = headless;
    this.browser = null;
    this.launchPromise = null;
  }

  async getBrowser() {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = puppeteer
      .launch({
        headless: this.headless,
        args: this.launchArgs,
      })
      .then((browser) => {
        this.browser = browser;
        this.logger.info('browser.started');

        browser.on('disconnected', () => {
          this.logger.warn('browser.disconnected');
          this.browser = null;
        });

        return browser;
      })
      .finally(() => {
        this.launchPromise = null;
      });

    return this.launchPromise;
  }

  async captureScreenshot({
    targetUrl,
    width,
    height,
    waitMs,
    navigationTimeoutMs,
    screenshotTimeoutMs,
    userAgent,
  }) {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      page.setDefaultNavigationTimeout(navigationTimeoutMs);
      page.setDefaultTimeout(navigationTimeoutMs);

      if (userAgent) {
        await page.setUserAgent(userAgent);
      }

      await page.setViewport({
        width,
        height,
        deviceScaleFactor: 1,
      });

      await page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: navigationTimeoutMs,
      });

      if (waitMs > 0) {
        await delay(waitMs);
      }

      return await withTimeout(
        page.screenshot({ type: 'png' }),
        screenshotTimeoutMs,
        'Screenshot rendering timed out.',
      );
    } catch (error) {
      if (error && typeof error.message === 'string' && error.message.includes('Target closed')) {
        this.browser = null;
      }

      throw error;
    } finally {
      await page.close({ runBeforeUnload: false }).catch((closeError) => {
        this.logger.warn('page.close_failed', { error: closeError.message });
      });
    }
  }

  getStats() {
    return {
      connected: Boolean(this.browser && this.browser.isConnected()),
      launching: Boolean(this.launchPromise),
    };
  }

  async close() {
    if (this.launchPromise) {
      await this.launchPromise.catch(() => null);
    }

    if (!this.browser) {
      return;
    }

    try {
      await this.browser.close();
      this.logger.info('browser.stopped');
    } catch (error) {
      this.logger.warn('browser.close_failed', { error: error.message });
    } finally {
      this.browser = null;
    }
  }
}
