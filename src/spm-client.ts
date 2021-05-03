import { URL } from 'url';

const https = require('https');
const http = require('http');

const DEFAULT_REGISTRY_CONFIG = {
    protocol: 'https:',
    host: 'spm-registry.herokuapp.com',
    port: 443,
    method: 'GET',
    path: '/api/v1/'
};

export class SpmClient {
    private static client;

    private registryConfig = DEFAULT_REGISTRY_CONFIG;

    public static getClient(spmRegistryUrl: URL) {
        if (!SpmClient.client) {
            SpmClient.client = new SpmClient(spmRegistryUrl);
        }
        return SpmClient.client;
    }

    constructor(spmRegistryUrl: URL) {
        if (spmRegistryUrl) {
            this.registryConfig.protocol = spmRegistryUrl.protocol;
            this.registryConfig.host = spmRegistryUrl.hostname;
            if (spmRegistryUrl.port) {
                this.registryConfig.port = parseInt(spmRegistryUrl.port, 10);
            }
        }
    }

    public async getPackageVersion(
        packageName: string,
        version: string,
        shouldIncludeBeta: boolean
    ): Promise<PackageVersion> {
        let path = `${
            this.registryConfig.path
        }package-version?package_name=${encodeURIComponent(packageName)}`;
        if (version.toLowerCase() !== 'latest') {
            path += `&version=${encodeURIComponent(version)}`;
        }
        path += `&include-beta=${shouldIncludeBeta ? 'true' : 'false'}`;
        const response = await this.request({ path });
        if (response.data) {
            return response.data;
        }
        // Package is not in registry
        throw new SpmPackageNotFoundError();
    }

    public async publishPackageVersion(
        versionId: string
    ): Promise<PackageVersion> {
        let path = `${
            this.registryConfig.path
        }package-version/${encodeURIComponent(versionId)}`;
        const response = await this.request({ path, method: 'POST' });
        return response.data;
    }

    private async request(params: any, postData?: string): Promise<SpmReponse> {
        return new Promise((resolve, reject) => {
            const httpParams = Object.assign(this.registryConfig, params);

            const client = httpParams.protocol === 'http:' ? http : https;

            const request = client.request(httpParams, (response) => {
                // Read response body
                const responseBodyBuffer = [];
                response.on('data', (chunk) => {
                    responseBodyBuffer.push(chunk);
                });
                // Handle end of response
                response.on('end', () => {
                    const responseBody = Buffer.concat(
                        responseBodyBuffer
                    ).toString();
                    // Handle Salesforce errors (unknown/deprecated package...)
                    if (response.statusCode === 424) {
                        const errorData = JSON.parse(responseBody);
                        return reject(
                            new SalesforcePackageError(
                                response.statusCode,
                                response.statusMessage,
                                errorData.errors
                            )
                        );
                    }
                    // Handle other invalid HTTP statuses
                    if (
                        response.statusCode < 200 ||
                        response.statusCode >= 300
                    ) {
                        return reject(
                            new RegistryError(
                                response.statusCode,
                                response.statusMessage,
                                responseBody
                            )
                        );
                    }
                    // Parse response body as JSON and resolve
                    try {
                        const data = JSON.parse(responseBody);
                        resolve({
                            statusCode: response.statusCode,
                            data
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            // Handle request timeout
            request.on('timeout', () => {
                request.destroy(new TimeoutError());
            });
            // Handle request errors
            request.on('error', (error) => {
                reject(error);
            });
            // Add POST data to request
            if (postData) {
                request.write(postData);
            }
            request.end();
        });
    }
}

export class SpmPackageNotFoundError extends Error {}

export class TimeoutError extends Error {}

export class RegistryError extends Error {
    statusCode: number;
    responseBody: string;

    constructor(
        statusCode: number,
        statusMessage: string,
        responseBody: string
    ) {
        super(statusMessage);
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }
}

export class SalesforcePackageError extends Error {
    statusCode: number;
    responseBody: string;
    errors: { title: string; detail: string }[];

    constructor(
        statusCode: number,
        statusMessage: string,
        errors: { title: string; detail: string }[]
    ) {
        super(statusMessage);
        this.statusCode = statusCode;
        this.errors = errors;
    }
}

interface SpmReponse {
    statusCode: number;
    data: any;
}

export interface PackageVersion {
    sfdc_id: string;
    name: string;
    version: string;
    published_date: number;
    is_beta: boolean;
}
