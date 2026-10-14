// Set in vite.config.ts from .env.local. The API key itself never reaches the browser.
declare const __OPENAI_ENABLED__: boolean;
declare const __OPENAI_IMAGE_MODEL__: string;

export const openAI = { enabled: __OPENAI_ENABLED__, model: __OPENAI_IMAGE_MODEL__ };
