import { macroFilters, temporalFilters } from "./state.js";

export function formatNumber(value) {
    return Number(value || 0).toLocaleString("pt-BR");
}

export function formatDays(value) {
    return `${Math.max(0, Math.round(Number(value) || 0))} dias`;
}

export function formatPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(1).replace(".", ",")}%`;
}

export function getNowStamp() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(
        now.getHours()
    ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
}

export function parseDateTime(value) {
    if (!value) {
        return null;
    }

    const normalized = String(value).replace(" ", "T");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function getMacroReferenceDate(rows) {
    const candidates = rows
        .flatMap((row) => [row.updated_at, row.finalized_at, row.created_at])
        .map(parseDateTime)
        .filter((value) => value instanceof Date);

    if (candidates.length === 0) {
        return new Date();
    }

    return candidates.reduce((maxDate, currentDate) => (currentDate > maxDate ? currentDate : maxDate), candidates[0]);
}

export function getSlaLimitDays(row, priorityValue) {
    const byPriority =
        priorityValue === 1
            ? toFiniteNumber(row.process_max_time_with_priority)
            : toFiniteNumber(row.process_max_time_without_priority);

    const fallback =
        toFiniteNumber(row.process_max_time) ||
        toFiniteNumber(row.process_max_time_with_priority) ||
        toFiniteNumber(row.process_max_time_without_priority);

    return byPriority || fallback || 0;
}

export function classifySlaRisk(ageDays, limitDays) {
    if (!Number.isFinite(ageDays) || !Number.isFinite(limitDays) || limitDays <= 0) {
        return "Sem referencia";
    }

    if (ageDays > limitDays) {
        return "Atrasado";
    }

    if (ageDays >= limitDays * 0.8) {
        return "Alerta";
    }

    return "No prazo";
}

function buildEvolutionIndex(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return {};
    }

    return rows.reduce((accumulator, row) => {
        const processId = Number(row?.process_id);
        if (!Number.isFinite(processId)) {
            return accumulator;
        }

        const movementDate = parseDateTime(row?.created_at);
        const previous = accumulator[processId] || {
            movementCount: 0,
            latestMovementDate: null,
            latestMovementRaw: "",
            latestStage: "",
        };

        const next = {
            ...previous,
            movementCount: previous.movementCount + 1,
        };

        if (movementDate && (!previous.latestMovementDate || movementDate > previous.latestMovementDate)) {
            next.latestMovementDate = movementDate;
            next.latestMovementRaw = String(row?.created_at || "");
            next.latestStage = String(row?.stages || row?.code || "Nao Informado");
        }

        accumulator[processId] = next;
        return accumulator;
    }, {});
}

export function enrichMacroRows(rows, evolutionRows = []) {
    const referenceDate = getMacroReferenceDate(rows);
    const evolutionIndex = buildEvolutionIndex(evolutionRows);

    const enriched = rows.map((row) => {
        const priorityValue = Number(row.priority_level || 0);
        const createdDate = parseDateTime(row.created_at);
        const finalizedDate = parseDateTime(row.finalized_at);
        const endDate = finalizedDate || referenceDate;
        const ageDays = createdDate ? Math.max(0, Math.round((endDate - createdDate) / 86400000)) : null;
        const slaLimitDays = getSlaLimitDays(row, priorityValue);
        const slaRisk = classifySlaRisk(ageDays, slaLimitDays);
        const overdueDays = Number.isFinite(ageDays) && Number.isFinite(slaLimitDays) ? Math.max(0, ageDays - slaLimitDays) : 0;

        const processId = Number(row.id);
        const processEvolution = Number.isFinite(processId) ? evolutionIndex[processId] : null;
        const movementDate = processEvolution?.latestMovementDate || parseDateTime(row.stage_started_at) || createdDate;
        const daysWithoutMovement = movementDate ? Math.max(0, Math.round((referenceDate - movementDate) / 86400000)) : null;

        return {
            ...row,
            _priority: priorityValue,
            _age_days: ageDays,
            _sla_limit_days: slaLimitDays,
            _sla_risk: slaRisk,
            _days_overdue: overdueDays,
            _is_overdue: overdueDays > 0,
            _stage_movement_count: Number(processEvolution?.movementCount || 0),
            _last_stage_movement_at: processEvolution?.latestMovementRaw || String(row.stage_started_at || ""),
            _last_stage_from_history: processEvolution?.latestStage || String(row.stage || "Nao Informado"),
            _days_without_stage_movement: daysWithoutMovement,
        };
    });

    return { referenceDate, rows: enriched };
}

export function filterMacroRows(rows) {
    return rows.filter((row) => {
        const orgao = String(row.orgao || "Nao Informado");
        const modality = String(row.modality || "Nao Informado");
        const stage = String(row.stage || "Nao Informado");

        if (macroFilters.orgao !== "all" && orgao !== macroFilters.orgao) {
            return false;
        }

        if (macroFilters.priority !== "all" && Number(macroFilters.priority) !== row._priority) {
            return false;
        }

        if (macroFilters.modality !== "all" && modality !== macroFilters.modality) {
            return false;
        }

        if (macroFilters.stage !== "all" && stage !== macroFilters.stage) {
            return false;
        }

        if (macroFilters.overdue === "only" && Number(row._days_overdue || 0) <= 0) {
            return false;
        }

        return true;
    });
}

export function aggregateCountBy(rows, keySelector) {
    return rows.reduce((accumulator, row) => {
        const key = keySelector(row);
        accumulator[key] = (accumulator[key] || 0) + 1;
        return accumulator;
    }, {});
}

export function formatDateLabel(date) {
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export function formatDateInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDateInput(value) {
    if (!value) {
        return null;
    }

    const [year, month, day] = String(value)
        .split("-")
        .map((part) => Number(part));

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }

    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function clampDate(date, minDate, maxDate) {
    if (date < minDate) {
        return new Date(minDate.getTime());
    }

    if (date > maxDate) {
        return new Date(maxDate.getTime());
    }

    return date;
}

export function getTemporalSourceDate(row) {
    return parseDateTime(row.created_at) || parseDateTime(row.updated_at);
}

export function collectTemporalDateBounds(rows) {
    const dates = rows.map(getTemporalSourceDate).filter((date) => date instanceof Date);

    if (dates.length === 0) {
        return null;
    }

    const minDate = dates.reduce((min, current) => (current < min ? current : min), dates[0]);
    const maxDate = dates.reduce((max, current) => (current > max ? current : max), dates[0]);

    return {
        minDate: new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()),
        maxDate: new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()),
    };
}

export function getTemporalDateRange(rows, granularity) {
    const bounds = collectTemporalDateBounds(rows);
    if (!bounds) {
        return null;
    }

    const selectedEnd = parseDateInput(temporalFilters.endDate) || bounds.maxDate;
    const endDateBase = clampDate(selectedEnd, bounds.minDate, bounds.maxDate);
    const endDate = new Date(
        endDateBase.getFullYear(),
        endDateBase.getMonth(),
        endDateBase.getDate(),
        23,
        59,
        59,
        999
    );

    if (granularity === "day") {
        const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - 29);

        return {
            startDate,
            endDate,
            ...bounds,
        };
    }

    const selectedStart = parseDateInput(temporalFilters.startDate) || bounds.minDate;
    let startDate = clampDate(selectedStart, bounds.minDate, bounds.maxDate);
    startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);

    if (startDate > endDate) {
        startDate = new Date(endDate.getTime());
    }

    return {
        startDate,
        endDate,
        ...bounds,
    };
}

export function getWeekStartDate(date) {
    const baseDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = baseDate.getDay();
    const offsetToMonday = day === 0 ? -6 : 1 - day;
    baseDate.setDate(baseDate.getDate() + offsetToMonday);
    return baseDate;
}

export function getIsoWeekInfo(date) {
    const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);

    return {
        week,
        year: utcDate.getUTCFullYear(),
    };
}

export function getTemporalBucketMeta(date, granularity) {
    if (granularity === "day") {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return {
            key,
            label: formatDateLabel(date),
            sortKey: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
        };
    }

    if (granularity === "week") {
        const weekStart = getWeekStartDate(date);
        const weekInfo = getIsoWeekInfo(weekStart);
        return {
            key: `${weekInfo.year}-W${String(weekInfo.week).padStart(2, "0")}`,
            label: `Sem ${String(weekInfo.week).padStart(2, "0")}/${weekInfo.year}`,
            sortKey: weekStart.getTime(),
        };
    }

    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthLabel = `${String(monthStart.getMonth() + 1).padStart(2, "0")}/${monthStart.getFullYear()}`;

    return {
        key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
        label: monthLabel,
        sortKey: monthStart.getTime(),
    };
}

export function buildTemporalBuckets(rows, granularity) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    const range = getTemporalDateRange(rows, granularity);
    if (!range) {
        return [];
    }

    const filteredRows = rows.filter((row) => {
        const baseDate = getTemporalSourceDate(row);
        if (!baseDate) {
            return false;
        }

        return baseDate >= range.startDate && baseDate <= range.endDate;
    });

    if (granularity === "total") {
        const groupedByOrgao = filteredRows.reduce((accumulator, row) => {
            const orgao = String(row.orgao || "Nao Informado");
            accumulator[orgao] = (accumulator[orgao] || 0) + 1;
            return accumulator;
        }, {});

        return [
            {
                label: "Total geral",
                sortKey: 0,
                total: filteredRows.length,
                byOrgao: groupedByOrgao,
            },
        ];
    }

    const bucketMap = new Map();

    if (granularity === "day") {
        const cursorDate = new Date(range.startDate.getTime());
        while (cursorDate <= range.endDate) {
            const bucketMeta = getTemporalBucketMeta(cursorDate, "day");
            bucketMap.set(bucketMeta.key, {
                label: bucketMeta.label,
                sortKey: bucketMeta.sortKey,
                total: 0,
                byOrgao: {},
            });

            cursorDate.setDate(cursorDate.getDate() + 1);
        }
    }

    filteredRows.forEach((row) => {
        const baseDate = getTemporalSourceDate(row);
        if (!baseDate) {
            return;
        }

        const bucketMeta = getTemporalBucketMeta(baseDate, granularity);
        const orgao = String(row.orgao || "Nao Informado");
        const currentBucket = bucketMap.get(bucketMeta.key) || {
            label: bucketMeta.label,
            sortKey: bucketMeta.sortKey,
            total: 0,
            byOrgao: {},
        };

        currentBucket.total += 1;
        currentBucket.byOrgao = {
            ...currentBucket.byOrgao,
            [orgao]: (currentBucket.byOrgao[orgao] || 0) + 1,
        };

        bucketMap.set(bucketMeta.key, currentBucket);
    });

    return [...bucketMap.values()].sort((a, b) => a.sortKey - b.sortKey);
}

function normalizeTextValue(value) {
    const raw = value === null || value === undefined ? "" : String(value).trim();
    return raw || "Nao Informado";
}

function normalizeComparableValue(value) {
    return normalizeTextValue(value)
        .toLocaleLowerCase("pt-BR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

export function parseDateTimeUtc(value) {
    if (!value) {
        return null;
    }

    const normalized = String(value).trim();
    const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (matched) {
        const year = Number(matched[1]);
        const month = Number(matched[2]);
        const day = Number(matched[3]);
        const hour = Number(matched[4] || 0);
        const minute = Number(matched[5] || 0);
        const second = Number(matched[6] || 0);
        const parsedUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
        return Number.isNaN(parsedUtc.getTime()) ? null : parsedUtc;
    }

    const fallback = new Date(normalized);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseDateInputUtc(value) {
    if (!value) {
        return null;
    }

    const [year, month, day] = String(value)
        .split("-")
        .map((part) => Number(part));

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }

    const parsedUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    return Number.isNaN(parsedUtc.getTime()) ? null : parsedUtc;
}

function formatDateLabelUtc(date) {
    return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function getUtcWeekStartDate(date) {
    const baseDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = baseDate.getUTCDay();
    const offsetToMonday = day === 0 ? -6 : 1 - day;
    baseDate.setUTCDate(baseDate.getUTCDate() + offsetToMonday);
    return baseDate;
}

function getUtcTemporalBucketMeta(date, granularity) {
    if (granularity === "day") {
        const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
        const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        return {
            key,
            label: formatDateLabelUtc(date),
            sortKey: dayStart.getTime(),
        };
    }

    if (granularity === "week") {
        const weekStart = getUtcWeekStartDate(date);
        const weekInfo = getIsoWeekInfo(weekStart);
        return {
            key: `${weekInfo.year}-W${String(weekInfo.week).padStart(2, "0")}`,
            label: `Sem ${String(weekInfo.week).padStart(2, "0")}/${weekInfo.year}`,
            sortKey: weekStart.getTime(),
        };
    }

    const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    return {
        key: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`,
        label: `${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}/${monthStart.getUTCFullYear()}`,
        sortKey: monthStart.getTime(),
    };
}

function collectEvolutionDateBounds(rows) {
    const dates = rows.map((row) => row.date).filter((date) => date instanceof Date);

    if (dates.length === 0) {
        return null;
    }

    const minDate = dates.reduce((min, current) => (current < min ? current : min), dates[0]);
    const maxDate = dates.reduce((max, current) => (current > max ? current : max), dates[0]);

    return {
        minDate: new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), minDate.getUTCDate(), 0, 0, 0, 0)),
        maxDate: new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth(), maxDate.getUTCDate(), 0, 0, 0, 0)),
    };
}

function getEvolutionDateRange(rows, granularity) {
    const bounds = collectEvolutionDateBounds(rows);
    if (!bounds) {
        return null;
    }

    const selectedEnd = parseDateInputUtc(temporalFilters.endDate) || bounds.maxDate;
    const endDateBase = clampDate(selectedEnd, bounds.minDate, bounds.maxDate);
    const endDate = new Date(Date.UTC(endDateBase.getUTCFullYear(), endDateBase.getUTCMonth(), endDateBase.getUTCDate(), 23, 59, 59, 999));

    if (granularity === "day") {
        const startDate = new Date(Date.UTC(endDateBase.getUTCFullYear(), endDateBase.getUTCMonth(), endDateBase.getUTCDate(), 0, 0, 0, 0));
        startDate.setUTCDate(startDate.getUTCDate() - 29);

        return {
            startDate,
            endDate,
            ...bounds,
        };
    }

    const selectedStart = parseDateInputUtc(temporalFilters.startDate) || bounds.minDate;
    let startDate = clampDate(selectedStart, bounds.minDate, bounds.maxDate);
    startDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(), 0, 0, 0, 0));

    if (startDate > endDate) {
        startDate = new Date(endDate.getTime());
    }

    return {
        startDate,
        endDate,
        ...bounds,
    };
}

export function normalizeEvolutionRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    return rows
        .map((row) => {
            const date = parseDateTimeUtc(row.created_at);
            if (!date) {
                return null;
            }

            const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

            return {
                date,
                dateKey,
                code: normalizeTextValue(row.code),
                stage: normalizeTextValue(row.stages),
                orgao: normalizeTextValue(row.orgao_sigla),
                orgao_id: row.orgao_id ?? null,
                modality: normalizeTextValue(row.modality),
                judgment: normalizeTextValue(row.judgment),
                dispute_mode: normalizeTextValue(row.dispute_mode),
                user_name: normalizeTextValue(row.user_name),
                topic: normalizeTextValue(row.topic),
                price_record: normalizeTextValue(row.price_record),
                specification: normalizeTextValue(row.specification),
                priority: Number(row.priority_level || 0),
                rn: Number(row.rn || 0),
                process_id: row.process_id ?? null,
            };
        })
        .filter(Boolean);
}

export function applyEvolutionFilters(rows, activeFilters = macroFilters) {
    return rows.filter((row) => {
        if (activeFilters.orgao !== "all" && normalizeComparableValue(row.orgao) !== normalizeComparableValue(activeFilters.orgao)) {
            return false;
        }

        if (activeFilters.priority !== "all" && Number(activeFilters.priority) !== row.priority) {
            return false;
        }

        if (activeFilters.modality !== "all" && normalizeComparableValue(row.modality) !== normalizeComparableValue(activeFilters.modality)) {
            return false;
        }

        if (activeFilters.stage !== "all") {
            const stageFilter = normalizeComparableValue(activeFilters.stage);
            const stageCode = normalizeComparableValue(row.code);
            const stageName = normalizeComparableValue(row.stage);
            if (stageCode !== stageFilter && stageName !== stageFilter) {
                return false;
            }
        }

        const filterToRowFieldMap = {
            judgment: "judgment",
            dispute_mode: "dispute_mode",
            user_name: "user_name",
            topic: "topic",
            price_record: "price_record",
            specification: "specification",
        };

        return Object.entries(filterToRowFieldMap).every(([filterKey, rowField]) => {
            if (!Object.prototype.hasOwnProperty.call(activeFilters, filterKey) || activeFilters[filterKey] === "all") {
                return true;
            }

            return normalizeComparableValue(row[rowField]) === normalizeComparableValue(activeFilters[filterKey]);
        });
    });
}

export function buildEvolutionTemporalBuckets(rows, granularity) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    const range = getEvolutionDateRange(rows, granularity);
    if (!range) {
        return [];
    }

    const filteredRows = rows.filter((row) => row.date >= range.startDate && row.date <= range.endDate);

    if (granularity === "total") {
        const groupedByCode = filteredRows.reduce((accumulator, row) => {
            const code = row.code || "Nao Informado";
            accumulator[code] = (accumulator[code] || 0) + 1;
            return accumulator;
        }, {});

        return [
            {
                label: "Total geral",
                sortKey: 0,
                total: filteredRows.length,
                byCode: groupedByCode,
            },
        ];
    }

    const bucketMap = new Map();

    if (granularity === "day") {
        const cursorDate = new Date(range.startDate.getTime());
        while (cursorDate <= range.endDate) {
            const bucketMeta = getUtcTemporalBucketMeta(cursorDate, "day");
            bucketMap.set(bucketMeta.key, {
                label: bucketMeta.label,
                sortKey: bucketMeta.sortKey,
                total: 0,
                byCode: {},
            });

            cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
        }
    }

    filteredRows.forEach((row) => {
        const bucketMeta = getUtcTemporalBucketMeta(row.date, granularity);
        const code = row.code || "Nao Informado";
        const currentBucket = bucketMap.get(bucketMeta.key) || {
            label: bucketMeta.label,
            sortKey: bucketMeta.sortKey,
            total: 0,
            byCode: {},
        };

        currentBucket.total += 1;
        currentBucket.byCode = {
            ...currentBucket.byCode,
            [code]: (currentBucket.byCode[code] || 0) + 1,
        };

        bucketMap.set(bucketMeta.key, currentBucket);
    });

    return [...bucketMap.values()].sort((a, b) => a.sortKey - b.sortKey);
}

export function aggregateEvolutionByBucketAndCode(buckets) {
    if (!Array.isArray(buckets) || buckets.length === 0) {
        return {
            labels: ["Sem dados"],
            totalsByBucket: [0],
            codeTotals: {},
            byCodeSeries: {},
        };
    }

    const labels = buckets.map((bucket) => bucket.label);
    const totalsByBucket = buckets.map((bucket) => Number(bucket.total || 0));
    const codeTotals = buckets.reduce((accumulator, bucket) => {
        Object.entries(bucket.byCode || {}).forEach(([code, count]) => {
            accumulator[code] = (accumulator[code] || 0) + Number(count || 0);
        });
        return accumulator;
    }, {});

    const byCodeSeries = Object.keys(codeTotals).reduce((accumulator, code) => {
        accumulator[code] = buckets.map((bucket) => Number(bucket.byCode?.[code] || 0));
        return accumulator;
    }, {});

    return {
        labels,
        totalsByBucket,
        codeTotals,
        byCodeSeries,
    };
}

export function csvEscape(value) {
    const raw = value === null || value === undefined ? "" : String(value);
    return `"${raw.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return "";
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.map(csvEscape).join(";")];

    rows.forEach((row) => {
        const line = headers.map((header) => csvEscape(row[header])).join(";");
        lines.push(line);
    });

    return lines.join("\n");
}
