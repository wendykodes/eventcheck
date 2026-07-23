import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Set viewport to a nice iPhone size
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  page.on('requestfailed', request => console.log('REQ FAILED:', request.url(), request.failure()?.errorText));

  console.log('Navigating to login...');
  await page.goto('http://localhost:5173/login');
  await page.waitForSelector('button');

  console.log('Logging in...');
  const buttons = await page.$$('button');
  const digitButtons = {};
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (/^[0-9]$/.test(text.trim())) {
      digitButtons[text.trim()] = btn;
    }
  }

  await digitButtons['1'].click();
  await digitButtons['2'].click();
  await digitButtons['3'].click();
  await digitButtons['4'].click();

  let submitBtn;
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Sign In')) {
      submitBtn = btn;
      break;
    }
  }
  await submitBtn.click();

  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  console.log('Logged in. Current URL:', page.url());

  // Go to Alice's profile page (user ID 2)
  console.log('Navigating to Alice\'s detail page (ID 2)...');
  await page.goto('http://localhost:5173/staff/2', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'scratch_debug/screenshot_staff.png' });
  console.log('Saved staff profile screenshot.');

  // Go to checkin
  console.log('Navigating to checkin page...');
  await page.goto('http://localhost:5173/checkin', { waitUntil: 'networkidle0' });
  
  // Click on the first event
  console.log('Selecting event...');
  await page.waitForSelector('.card');
  const eventCards = await page.$$('.card');
  await eventCards[0].click();
  await new Promise(r => setTimeout(r, 1000));

  // Click on 'General Check-In' station
  console.log('Selecting activity station...');
  await page.waitForSelector('.card');
  const stationCards = await page.$$('.card');
  await stationCards[0].click();
  await new Promise(r => setTimeout(r, 1000));

  // Search for 'John Smith'
  console.log('Searching for John...');
  await page.waitForSelector('input[type="text"]');
  await page.type('input[type="text"]', 'John');
  await new Promise(r => setTimeout(r, 1000));

  // Open bottom sheet by clicking the name part of John Smith's card
  console.log('Opening guest bottom sheet...');
  const guestLink = await page.$('.card button');
  await guestLink.click();
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'scratch_debug/screenshot_sheet_open.png' });
  console.log('Saved bottom sheet open screenshot.');

  // Confirm Check-In
  console.log('Confirming check-in...');
  // Find button with text 'Confirm Check-In'
  const sheetButtons = await page.$$('button');
  let confirmBtn;
  for (const btn of sheetButtons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Confirm Check-In')) {
      confirmBtn = btn;
      break;
    }
  }
  if (confirmBtn) {
    await confirmBtn.click();
    console.log('Clicked Confirm Check-In.');
  } else {
    console.log('Confirm Check-In button not found!');
  }
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'scratch_debug/screenshot_after_confirm.png' });
  console.log('Saved screenshot after confirm.');

  // Open bottom sheet again to test Undo
  console.log('Opening sheet again to test Undo...');
  const guestLink2 = await page.$('.card button');
  await guestLink2.click();
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'scratch_debug/screenshot_sheet_checked_in.png' });
  console.log('Saved sheet checked in screenshot.');

  // Click Undo
  console.log('Clicking Undo...');
  const sheetButtons2 = await page.$$('button');
  let undoBtn;
  for (const btn of sheetButtons2) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Undo')) {
      undoBtn = btn;
      break;
    }
  }
  if (undoBtn) {
    await undoBtn.click();
    console.log('Clicked Undo.');
  } else {
    console.log('Undo button not found!');
  }
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'scratch_debug/screenshot_after_undo.png' });
  console.log('Saved screenshot after undo.');

  console.log('Done!');
  await browser.close();
})();
