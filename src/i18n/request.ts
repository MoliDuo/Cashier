import { getRequestConfig } from "next-intl/server";
import messages from "../../messages/zh.json";

/**
 * Cashier is written in Chinese, for the two people who keep this ledger.
 * next-intl stays because it is where the strings live and what formats them;
 * there is simply nothing to negotiate.
 */
export default getRequestConfig(async () => ({ locale: "zh", messages }));
