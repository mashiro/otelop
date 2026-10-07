import { parseLogSearch } from "./log-search";

export const metricFields = ["name", "service_name", "type", "unit", "description"] as const;
export const parseMetricSearch = (search: string) => parseLogSearch(search, metricFields);
