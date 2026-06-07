document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const collectBtn = document.getElementById("collect");
  const autoCollectBtn = document.getElementById("autoCollect");
  const stopBtn = document.getElementById("stop");
  const exportBtn = document.getElementById("export");
  const clearBtn = document.getElementById("clear");
  const pageLimitInput = document.getElementById("pageLimit");

  let shouldStop = false;

  collectBtn.addEventListener("click", async () => {
    const count = await collectCurrentPage();
    statusEl.innerText = `Collected ${count} leads from current page`;
  });

  autoCollectBtn.addEventListener("click", async () => {
    shouldStop = false;

    const pageLimit = Number(pageLimitInput.value || 1);

    for (let i = 0; i < pageLimit; i++) {
      if (shouldStop) {
        statusEl.innerText = "Stopped";
        break;
      }

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const currentUrl = new URL(tab.url);
      const currentPage = Number(currentUrl.searchParams.get("page") || 1);

      statusEl.innerText = `Collecting page ${currentPage}...`;

      const count = await collectCurrentPage();

      const hasNextPage = await checkHasNextPage();

      if (!hasNextPage) {
        statusEl.innerText = `Done. Last page reached. Last collected: ${count}`;
        break;
      }

      if (i === pageLimit - 1) {
        statusEl.innerText = `Done. Reached page limit: ${pageLimit}`;
        break;
      }

      statusEl.innerText = `Scrolling before moving to page ${currentPage + 1}...`;

      await performPreNextScroll();

      currentUrl.searchParams.set("page", String(currentPage + 1));

      await chrome.tabs.update(tab.id, {
        url: currentUrl.toString(),
      });

      await sleep(getRandomDelay(2500, 4000));
    }
  });

  stopBtn.addEventListener("click", () => {
    shouldStop = true;
  });

  exportBtn.addEventListener("click", async () => {
    const { leads = [] } = await chrome.storage.local.get(["leads"]);

    if (!leads.length) {
      statusEl.innerText = "No data to export";
      return;
    }

    const csv = convertToCSV(leads);
    downloadCSV(csv, "linkedin-leads.csv");

    statusEl.innerText = `Exported ${leads.length} leads`;
  });

  clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.set({ leads: [] });
    statusEl.innerText = "Data cleared";
  });
});

async function collectCurrentPage() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapeLinkedInPeople,
  });

  const { leads = [] } = await chrome.storage.local.get(["leads"]);
  const merged = deduplicateByProfileUrl([...leads, ...result]);

  await chrome.storage.local.set({ leads: merged });

  return result.length;
}

async function checkHasNextPage() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const buttonsAndLinks = Array.from(
        document.querySelectorAll("button, a")
      );

      return buttonsAndLinks.some((el) => {
        const text = String(el.innerText || "").trim().toLowerCase();
        const aria = String(el.getAttribute("aria-label") || "").toLowerCase();
        const disabled =
          el.disabled || el.getAttribute("aria-disabled") === "true";

        return !disabled && (text === "next" || aria.includes("next"));
      });
    },
  });

  return Boolean(result);
}

async function performPreNextScroll() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function random(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      function getScrollableElement() {
        const candidates = [
          document.scrollingElement,
          document.documentElement,
          document.body,
          document.querySelector("main"),
          document.querySelector("#workspace"),
          document.querySelector('[data-testid="lazy-column"]'),
          ...Array.from(document.querySelectorAll("div")),
        ].filter(Boolean);

        return (
          candidates.find((el) => {
            const style = window.getComputedStyle(el);

            return (
              el.scrollHeight > el.clientHeight + 100 &&
              ["auto", "scroll", "overlay", "visible"].includes(style.overflowY)
            );
          }) || document.scrollingElement
        );
      }

      async function smoothScrollElementTo(el, targetY, duration = 800) {
        const startY = el.scrollTop;
        const distance = targetY - startY;
        const startTime = performance.now();

        return new Promise((resolve) => {
          function step(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const eased =
              progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            el.scrollTop = startY + distance * eased;

            if (progress < 1) {
              requestAnimationFrame(step);
            } else {
              resolve();
            }
          }

          requestAnimationFrame(step);
        });
      }

      const el = getScrollableElement();
      const maxScrollTop = el.scrollHeight - el.clientHeight;

      let currentY = el.scrollTop;
      const cycleCount = random(1, 2);
      for (let i = 0; i < cycleCount; i++) {
        const downDistance = random(300, 600);
        currentY = Math.min(currentY + downDistance, maxScrollTop);

        await smoothScrollElementTo(el, currentY, random(350, 650));
        await sleep(random(150, 350));

        const upDistance = random(100, 250);
        currentY = Math.max(currentY - upDistance, 0);

        await smoothScrollElementTo(el, currentY, random(300, 550));
        await sleep(random(150, 350));
      }

      await sleep(random(200, 500));

      await smoothScrollElementTo(el, maxScrollTop, random(600, 1000));
      await sleep(random(500, 900));
    },
  });
}

function scrapeLinkedInPeople() {
  function cleanText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function cleanName(text) {
    return cleanText(text)
      .replace(/\s*•\s*(1st|2nd|3rd\+?)\s*/gi, "")
      .replace(/\s*Premium\s*/gi, "")
      .trim();
  }

  function dedupeInsidePage(leads) {
    const map = new Map();

    leads.forEach((lead) => {
      const key =
        lead.profileUrl || `${lead.name}-${lead.title}-${lead.location}`;
      map.set(key, lead);
    });

    return Array.from(map.values());
  }

  function isIgnoredLine(line) {
    const ignoredExact = [
      "View",
      "Connect",
      "Message",
      "Follow",
      "Premium",
      "Visit my website",
    ];

    return (
      !line ||
      ignoredExact.includes(line) ||
      line.includes("mutual connection") ||
      line.includes("followers") ||
      line.startsWith("Past:") ||
      line.startsWith("Current:") ||
      line.includes("Easily find people") ||
      line.includes("Search more efficiently") ||
      line.includes("Try Premium")
    );
  }

  const url = new URL(window.location.href);
  const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));

  const leads = listItems
    .map((item) => {
      const realProfileLink = item.querySelector('a[href*="/in/"]');
      const profileUrl = realProfileLink
        ? realProfileLink.href.split("?")[0]
        : "";

      const lines = item.innerText
        .split("\n")
        .map(cleanText)
        .filter((line) => !isIgnoredLine(line));

      if (!lines.length) return null;

      const name = cleanName(lines[0]);
      const title = lines[1] || "";
      const location = lines[2] || "";

      if (!name || !title) return null;

      return {
        name,
        title,
        location,
        profileUrl,
        page: url.searchParams.get("page") || "1",
        keyword: url.searchParams.get("keywords") || "",
        collectedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  return dedupeInsidePage(leads);
}

function deduplicateByProfileUrl(leads) {
  const map = new Map();

  leads.forEach((lead) => {
    const key = lead.profileUrl || `${lead.name}-${lead.title}-${lead.location}`;
    map.set(key, lead);
  });

  return Array.from(map.values());
}

function convertToCSV(data) {
  const headers = [
    "name",
    "title",
    "location",
    "profileUrl",
    "page",
    "keyword",
    "collectedAt",
  ];

  const rows = data.map((item) =>
    headers.map((header) => escapeCSV(item[header] || "")).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

function escapeCSV(value) {
  const stringValue = String(value).replaceAll('"', '""');
  return `"${stringValue}"`;
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}