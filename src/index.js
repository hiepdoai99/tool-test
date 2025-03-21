import dotenv from 'dotenv';
dotenv.config();

import GoLogin from 'gologin/src/gologin.js';
import puppeteer from 'puppeteer-core';
import { join } from 'path';
import { homedir } from 'os';

const SCALE = parseFloat(process.env.SCALE) || 1;
const CONCURRENCY = parseInt(process.env.CONCURRENCY) || 1;
const DEFAULT_WEB_FOCUS = process.env.DEFAULT_WEB_FOCUS || 'https://www.example.com';
const TOKEN_GOLOGIN = process.env.TOKEN_GOLOGIN;
const PLATFORM_OS = process.platform === 'win32' ? 'win' : 'mac';

const DELAYTAB = 5000

function generateRandomName() {
  return `Profile-${Math.random().toString(36).substring(2, 7)}`;
}

function getResolution(scale) {
  const width = Math.floor(1024 * scale);
  const height = Math.floor(768 * scale);
  return `${width}x${height}`;
}

function getChromeExecutablePath() {
  if (process.platform === 'win32') {
    return join(homedir(), '.gologin', 'browser', 'orbita-browser-133', 'chrome.exe');
  }
  return undefined;
}

async function createProfile(proxyOptions) {
  const GL = new GoLogin({ token: TOKEN_GOLOGIN });
  const profileOptions = {
    ...proxyOptions,
    name: generateRandomName(),
    navigator: {
      language: 'en-US,en;q=0.9',
      userAgent: 'random',
      resolution: getResolution(SCALE)
    },
    proxyEnabled: true,
  };
  return await GL.create(profileOptions);
}

async function browserRunner(profileId) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-notifications',
    '--disable-extensions'
  ];

  const GLOptions = {
    token: TOKEN_GOLOGIN,
    profile_id: profileId,
    args,
    ...(process.platform === 'win32' && { executablePath: getChromeExecutablePath() }),
  };

  const GL = new GoLogin(GLOptions);

  try {
    const { wsUrl } = await GL.start();
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsUrl,
      ignoreHTTPSErrors: true,
      defaultViewport: null
    });
    const [page] = await browser.pages();
    // Không chờ page.goto để tránh chậm, bạn có thể điều chỉnh nếu cần
    page.goto(DEFAULT_WEB_FOCUS, { waitUntil: 'networkidle2' })
      .catch(error => console.error(`Lỗi khi load ${DEFAULT_WEB_FOCUS} với profile ${profileId}:`, error));
    console.log(`Đã khởi chạy profile ${profileId} và bắt đầu mở ${DEFAULT_WEB_FOCUS}`);
    return { browser, GL };
  } catch (error) {
    console.error(`Error launching browser for profile ${profileId}`, error);
    throw error;
  }
}

// Hàm delay trả về Promise sau khoảng thời gian ms
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const proxyOptions = {
    os: PLATFORM_OS,
    proxy: {
      mode: 'socks5',
      host: '127.0.0.1',
      port: 60000
    }
  };

  console.log(`Đang tạo ${CONCURRENCY} profile với scale ${SCALE}...`);

  // Tạo profile song song
  const profilePromises = Array.from({ length: CONCURRENCY }).map(async (_, i) => {
    console.log(`Đang tạo profile ${i + 1}...`);
    const profileId = await createProfile(proxyOptions);
    console.log(`Profile ${i + 1} được tạo với ID: ${profileId}`);
    return profileId;
  });

  const profileIds = await Promise.all(profilePromises);

  // Mở trình duyệt cho các profile với delay 5 giây giữa các lần khởi chạy,
  // không chờ cho profile trước load xong mới bắt đầu delay.
  const tasks = profileIds.map((profileId, index) =>
    delay(index * DELAYTAB).then(() => {
      console.log(`Đang khởi chạy trình duyệt cho profile ${profileId}...`);
      return browserRunner(profileId);
    })
  );

  // Tiến hành chạy các task đã được lên lịch
  try {
    await Promise.all(tasks);
  } catch (error) {
    console.error('Error:', error);
  }
})();

