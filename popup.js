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

  function degreeRegex() {
    return /(1st|2nd|3rd\+|Cấp\s*1\+?|Cấp\s*2\+?|Cấp\s*3\+?)/i;
  }

  function extractConnectionDegree(text) {
    const match = cleanText(text).match(degreeRegex());
    return match ? cleanText(match[1]) : "";
  }

  function cleanName(text) {
    return cleanText(text)
      .replace(/[•·]?\s*(1st|2nd|3rd\+|Cấp\s*1\+?|Cấp\s*2\+?|Cấp\s*3\+?)\s*/gi, "")
      .replace(/Verified/gi, "")
      .replace(/Premium/gi, "")
      .replace(/[•·]/g, "")
      .trim();
  }

  function cleanField(text) {
    return cleanText(text)
      .replace(/^Current:\s*/i, "")
      .replace(/^Past:\s*/i, "")
      .replace(/^Hiện tại:\s*/i, "")
      .replace(/^Trước đây:\s*/i, "")
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

  const url = new URL(window.location.href);
  const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));

  const leads = listItems
    .map((item) => {
      const profileLinks = Array.from(item.querySelectorAll('a[href*="/in/"]'));

      const nameProfileLink = profileLinks.find((link) =>
        Boolean(link.closest("p"))
      );

      const fallbackProfileLink = profileLinks[0];

      const profileUrl = fallbackProfileLink
        ? fallbackProfileLink.href.split("?")[0]
        : "";

      let nameP = nameProfileLink?.closest("p");

      if (!nameP) {
        nameP = Array.from(item.querySelectorAll("p")).find((p) => {
          const text = cleanText(p.innerText);
          return text === "LinkedIn Member" || text === "Thành viên LinkedIn";
        });
      }

      if (!nameP) return null;

      const rawName = nameProfileLink
        ? nameProfileLink.innerText
        : nameP.innerText;

      const name = cleanName(rawName);
      const connectionDegree = extractConnectionDegree(nameP.innerText);

      const infoContainer = nameP.parentElement;
      if (!infoContainer) return null;

      const siblings = Array.from(infoContainer.children);
      const nameIndex = siblings.indexOf(nameP);

      const infoBlocks = siblings
        .slice(nameIndex + 1)
        .filter((el) => el.tagName === "DIV")
        .map((el) => cleanField(el.innerText))
        .filter(Boolean);

      const title = infoBlocks[0] || "";
      const location = infoBlocks[1] || "";

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