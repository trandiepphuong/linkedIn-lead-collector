document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const collectBtn = document.getElementById("collect");
  const exportBtn = document.getElementById("export");
  const clearBtn = document.getElementById("clear");

  collectBtn.addEventListener("click", async () => {
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

    statusEl.innerText = `Collected ${result.length}. Total: ${merged.length}`;
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

function scrapeLinkedInPeople() {
  function cleanText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function extractConnectionDegree(text) {
    const match = cleanText(text).match(/(1st|2nd|3rd\+?)/i);
    return match ? match[1] : "";
  }

function isDegreeLine(text) {
  const cleaned = cleanText(text)
    .replace(/[•·]/g, "")
    .replace(/\s+/g, "")
    .trim();

  return /^(1st|2nd|3rd\+?)$/i.test(cleaned);
}

function removeDegreeFromLine(text) {
  return cleanText(text)
    .replace(/[•·]\s*(1st|2nd|3rd\+?)/gi, "")
    .replace(/\b(1st|2nd|3rd\+?)\b/gi, "")
    .replace(/[•·]/g, "")
    .trim();
}

function cleanName(text) {
  return removeDegreeFromLine(text)
    .replace(/\s*Premium\s*/gi, "")
    .trim();
}

  function dedupeInsidePage(leads) {
    const map = new Map();

    leads.forEach((lead) => {
      const key =
        lead.profileUrl ||
        `${lead.name}-${lead.connectionDegree}-${lead.title}-${lead.location}`;

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
      "View my blog",
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

      let lines = item.innerText
        .split("\n")
        .map(cleanText)
        .filter((line) => !isIgnoredLine(line));

      if (!lines.length) return null;

      const rawName = lines[0];

const connectionDegree =
  extractConnectionDegree(rawName) ||
  lines.map(extractConnectionDegree).find(Boolean) ||
  "";

const name = cleanName(rawName);

const contentLines = lines
  .slice(1)
  .map(removeDegreeFromLine)
  .filter((line) => line && !isDegreeLine(line));

const title = contentLines[0] || "";
const location = contentLines[1] || "";

      if (!name || !title) return null;

      return {
        name,
        connectionDegree,
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
    "connectionDegree",
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