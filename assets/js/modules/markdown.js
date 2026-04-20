import { COLORS } from "./state.js";

export const sanitizeHtml = (value) =>
    String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

export function renderMarkdown(text) {
    if (!text) {
        return "Insights nao disponiveis no JSON.";
    }

    const safe = sanitizeHtml(text);
    const lines = safe.split("\n");
    const result = [];
    let inList = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (line.startsWith("- ")) {
            if (!inList) {
                result.push("<ul>");
                inList = true;
            }
            const item = line.slice(2).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
            result.push(`<li>${item}</li>`);
            continue;
        }

        if (inList) {
            result.push("</ul>");
            inList = false;
        }

        if (!line) {
            result.push("<br>");
            continue;
        }

        if (line.startsWith("### ")) {
            result.push(`<p><strong>${line.slice(4)}</strong></p>`);
            continue;
        }

        result.push(`<p>${line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</p>`);
    }

    if (inList) {
        result.push("</ul>");
    }

    return result.join("");
}

export function fillLegend(containerId, items, formatter, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    const onToggle = typeof options.onToggle === "function" ? options.onToggle : null;
    const isActive = typeof options.isActive === "function" ? options.isActive : () => true;
    const getColor = typeof options.getColor === "function" ? options.getColor : (_item, index) => COLORS[index % COLORS.length];

    container.innerHTML = "";
    items.forEach((item, index) => {
        const legendItem = document.createElement("span");
        const active = Boolean(isActive(item, index));
        legendItem.className = `legend-item${onToggle ? " legend-item-clickable" : ""}${active ? "" : " legend-item-inactive"}`;
        legendItem.innerHTML = `
            <span class="legend-color" style="background:${getColor(item, index)}"></span>
            <span>${formatter(item)}</span>
          `;

        if (onToggle) {
            legendItem.setAttribute("role", "button");
            legendItem.tabIndex = 0;
            legendItem.addEventListener("click", () => onToggle(item, index));
            legendItem.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggle(item, index);
                }
            });
        }

        container.appendChild(legendItem);
    });
}

export function fillCustomLegend(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    container.innerHTML = "";
    items.forEach((item) => {
        const legendItem = document.createElement("span");
        legendItem.className = "legend-item";
        legendItem.innerHTML = `
            <span class="legend-color" style="background:${item.color}"></span>
            <span>${item.label}</span>
          `;
        container.appendChild(legendItem);
    });
}
