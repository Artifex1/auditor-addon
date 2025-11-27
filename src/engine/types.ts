export enum SupportedLanguage {
    Solidity = "solidity",
    // Future languages:
    // TypeScript = "typescript",
    // JavaScript = "javascript",
}

export interface Entrypoint {
    file: string;
    contract: string;
    name: string;
    signature: string;
    visibility: string;
    location: {
        line: number;
        column: number;
    };
}

export interface FunctionInsights {
    // TODO: Define structure
}

export interface FileContent {
    path: string;
    content: string;
}
