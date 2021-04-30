import { spawn, ChildProcess } from 'child_process';
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { AnyJson } from '@salesforce/ts-types';
import {
    SpmClient,
    PackageVersion,
    SpmPackageNotFoundError,
    TimeoutError,
    RegistryError
} from '../../spm-client';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('spm-plugin', 'install');

const SPM_INTERNAL_FLAGS = ['name', 'version', 'includebeta'];
const APEX_COMPILE_VALUES = ['all', 'package'];
const SECURITY_TYPE_VALUES = ['AllUsers', 'AdminsOnly'];
const UPGRADE_TYPE_VALUES = ['DeprecateOnly', 'Mixed', 'Delete'];

export default class Install extends SfdxCommand {
    public static description = messages.getMessage('docCommand');

    public static examples = [
        `$ sfdx spm:install -n 'Streaming Monitor' -u ebikes       
    Querying SPM registry... done
    Found package 'Streaming Monitor@3.2' with ID 04t1t000003DLAL

    sfdx force:package:install --package 04t1t000003DLAL --targetusername ebikes --loglevel warn

    PackageInstallRequest is currently InProgress. You can continue to query the status using
    sfdx force:package:install:report -i 0Hf3F0000005lG0SAI -u test-cus7edbxwwy1@example.com

`,
        `$ sfdx spm:install -n Quiz -i -u quizOrg -w 10
    Querying SPM registry... done
    Found package 'Quiz@2.6' with ID 04t5p000001BloG

    sfdx force:package:install --package 04t5p000001BloG --targetusername quizOrg --wait 10 --loglevel warn

    This package might send or receive data from these third-party websites:

    https://chart.googleapis.com

    Grant access (y/n)?: y

    Waiting for the package install request to complete. Status = IN_PROGRESS
    Waiting for the package install request to complete. Status = IN_PROGRESS
    Successfully installed package [04t5p000001BloG]
`
    ];

    protected static flagsConfig = {
        name: flags.string({
            char: 'n',
            description: messages.getMessage('docNameFlag'),
            required: true
        }),
        version: flags.string({
            char: 'v',
            description: messages.getMessage('docVersionFlag'),
            default: 'latest'
        }),
        includebeta: flags.boolean({
            char: 'i',
            description: messages.getMessage('docIncludeBetaFlag'),
            default: false
        }),
        registryurl: flags.url({
            char: 'z',
            description: messages.getMessage('docRegistryUrlFlag'),
            default: null
        }),
        // force:package:install flags
        apexcompile: flags.enum({
            char: 'a',
            description: messages.getMessage('docApexCompile'),
            options: APEX_COMPILE_VALUES
        }),
        publishwait: flags.minutes({
            char: 'b',
            description: messages.getMessage('docPublishWait')
        }),
        installationkey: flags.string({
            char: 'k',
            description: messages.getMessage('docInstallationKey')
        }),
        noprompt: flags.boolean({
            char: 'r',
            description: messages.getMessage('docNoPrompt'),
            default: false
        }),
        securitytype: flags.enum({
            char: 's',
            description: messages.getMessage('docSecurityType'),
            options: SECURITY_TYPE_VALUES,
            default: SECURITY_TYPE_VALUES[1]
        }),
        upgradetype: flags.enum({
            char: 't',
            description: messages.getMessage('docUpgradeType'),
            options: UPGRADE_TYPE_VALUES,
            default: UPGRADE_TYPE_VALUES[1]
        }),
        wait: flags.minutes({
            char: 'w',
            description: messages.getMessage('docWait')
        })
    };

    protected static requiresUsername = true;
    protected static supportsDevhubUsername = false;
    protected static requiresProject = false;

    public async run(): Promise<AnyJson> {
        const { name, version, includebeta, registryurl } = this.flags;

        const spmClient = SpmClient.getClient(registryurl);

        this.ux.startSpinner(messages.getMessage('queryingRegistry'), null, {
            stdout: true
        });

        let packageVersion: PackageVersion;
        try {
            packageVersion = await spmClient.getPackageVersion(
                name,
                version,
                includebeta
            );
            this.ux.stopSpinner('done');
            this.ux.log(
                messages.getMessage('foundPackageVersion', [
                    name,
                    packageVersion.version,
                    packageVersion.sfdc_id
                ])
            );
        } catch (error) {
            this.ux.stopSpinner('ERROR');
            if (error instanceof SpmPackageNotFoundError) {
                if (includebeta) {
                    throw new SfdxError(
                        messages.getMessage('errorNoBetaPackageResults', [name])
                    );
                } else {
                    throw new SfdxError(
                        messages.getMessage('errorNoStablePackageResults', [
                            name
                        ])
                    );
                }
            }
            if (error instanceof TimeoutError) {
                throw new SfdxError(
                    messages.getMessage('errorRegistryTimeout')
                );
            }
            if (error instanceof RegistryError) {
                throw new SfdxError(
                    messages.getMessage('errorRegistryInternal', [
                        error.statusCode,
                        error.message
                    ])
                );
            }
            throw new SfdxError(messages.getMessage('errorUnknown', [error]));
        }

        // Prepare package install command
        this.ux.log();
        const args = [
            'force:package:install',
            '--package',
            packageVersion.sfdc_id
        ];
        for (const [key, value] of Object.entries(this.flags)) {
            // Skip this command's flags, only use force:package:install flags
            if (!SPM_INTERNAL_FLAGS.includes(key)) {
                // Add inherited flags (targetusername...)
                if (Install.flagsConfig[key] === undefined) {
                    if (typeof value === 'boolean') {
                        if (value) {
                            args.push(`--${key}`);
                        }
                    } else {
                        args.push(`--${key}`);
                        args.push(value);
                    }
                }
                // Skip flags with default values
                else if (value !== Install.flagsConfig[key].default) {
                    if (typeof value === 'boolean') {
                        if (value) {
                            args.push(`--${key}`);
                        }
                    } else if (value instanceof Duration) {
                        args.push(`--${key}`);
                        args.push(value.quantity.toString());
                    } else {
                        args.push(`--${key}`);
                        args.push(value);
                    }
                }
            }
        }
        this.ux.log('sfdx ' + args.join(' '));
        this.ux.log();

        const childProcess = spawn('sfdx', args, {
            stdio: [process.stdin, process.stdout, process.stderr]
        });
        await this.waitForChildProcessExit(childProcess);

        // Return an object to be displayed with --json
        return packageVersion as any;
    }

    private waitForChildProcessExit(childProcess: ChildProcess): Promise<void> {
        return new Promise((resolve, reject) => {
            childProcess.once('exit', (code: number, signal: string) => {
                if (code === 0) {
                    resolve(undefined);
                } else {
                    reject(new Error('Exit with error code: ' + code));
                }
            });
            childProcess.once('error', (err: Error) => {
                reject(err);
            });
        });
    }
}
