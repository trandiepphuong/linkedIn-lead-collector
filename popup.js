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

  function dedupeInsidePage(leads) {
    const map = new Map();

    leads.forEach((lead) => {
      const key =
        lead.profileUrl || `${lead.name}-${lead.title}-${lead.location}`;

      map.set(key, lead);
    });

    return Array.from(map.values());
  }

  const url = new URL(window.location.href);
  const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));

  const leads = listItems
    .map((item) => {
  const profileLink =
    item.querySelector('a[href*="/in/"]') ||
    item.querySelector("a");

  if (!profileLink) return null;

  const rawProfileUrl = profileLink.href?.split("?")[0] || "";
  const hasRealProfileUrl = rawProfileUrl.includes("linkedin.com/in/");

  const allTexts = Array.from(item.querySelectorAll("p, div, span, a"))
    .map((el) => cleanText(el.innerText))
    .filter(Boolean);

  const uniqueTexts = [...new Set(allTexts)];

  const ignoredTexts = [
    "View",
    "Connect",
    "Message",
    "Follow",
    "Premium",
    "Visit my website",
  ];

  const usefulTexts = uniqueTexts.filter((text) => {
    return (
      text &&
      !ignoredTexts.includes(text) &&
      !text.includes("mutual connection") &&
      !text.includes("followers") &&
      !text.match(/^•/)
    );
  });

  const name = hasRealProfileUrl
    ? cleanText(profileLink.innerText)
        .replace("Premium", "")
        .replace("• 1st", "")
        .replace("• 2nd", "")
        .replace("• 3rd+", "")
        .trim()
    : usefulTexts[0] || "";

  if (!name) return null;

  const nameIndex = usefulTexts.findIndex((text) => text.includes(name));

  const afterNameTexts = usefulTexts.slice(nameIndex + 1);

  return {
    name,
    title: afterNameTexts[0] || "",
    location: afterNameTexts[1] || "",
    profileUrl: hasRealProfileUrl ? rawProfileUrl : "",
    page: url.searchParams.get("page") || "1",
    keyword: url.searchParams.get("keywords") || "",
    collectedAt: new Date().toISOString(),
  };
});

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