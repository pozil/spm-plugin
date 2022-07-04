import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import {
    SpmClient,
    SalesforcePackageError,
    TimeoutError,
    RegistryError,
    PackageVersion
} from '../../spm-client';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('spm-plugin', 'publish');

const REGEX_SALESFORCE_PACKAGE_VERSION_ID =
    /^04t([a-zA-Z0-9]{12}|[a-zA-Z0-9]{15})$/;

export default class Publish extends SfdxCommand {
    public static description = messages.getMessage('docCommand');

    public static examples = [
        `$ sfdx spm:publish -v 04t1t000003DLAL
    Updating SPM registry... done
    Published package version:
    description:   Developer/Admin tool that lets you monitor streaming events (PushTopic, generic, standard/custom platform events, CDC and monitoring events)
    id:            04t1t000003DLAL
    name:          Streaming Monitor
    publisher:     Salesforce Labs*
    versionName:   Fixed custom CDC detection
    versionNumber: 3.2

`
    ];

    protected static flagsConfig = {
        version: flags.string({
            char: 'v',
            description: messages.getMessage('docVersionFlag'),
            required: true
        }),
        registryurl: flags.url({
            char: 'z',
            description: messages.getMessage('docRegistryUrlFlag'),
            default: null
        })
    };

    protected static supportsUsername = false;
    protected static supportsDevhubUsername = false;
    protected static requiresProject = false;

    public async run(): Promise<PackageVersion> {
        let versionId = this.flags.version;
        if (!REGEX_SALESFORCE_PACKAGE_VERSION_ID.test(versionId)) {
            throw new SfdxError(
                messages.getMessage('errorInvalidIdFormat', [versionId])
            );
        }
        versionId = versionId.substring(0, 15);

        const spmClient = SpmClient.getClient(this.flags.registryurl);

        this.ux.startSpinner(messages.getMessage('updatingRegistry'), null, {
            stdout: true
        });

        let pakageInfo : PackageVersion;
        try {
            pakageInfo = await spmClient.publishPackageVersion(versionId);
            this.ux.stopSpinner('done');
            this.ux.log();
            this.ux.log(messages.getMessage('successInfo'));
            this.ux.styledObject(pakageInfo);
        } catch (publishError) {
            this.ux.stopSpinner('ERROR');
            // Salesforce errors (unknown/deprecated package...)
            if (publishError instanceof SalesforcePackageError) {
                this.ux.log(messages.getMessage('errorSalesforce'));
                for (const error of publishError.errors) {
                    this.ux.styledObject(error, ['title', 'detail']);
                    this.ux.log();
                }
                throw new SfdxError(
                    messages.getMessage('errorPackageUnavailable', [versionId])
                );
            }
            // Registry connection timout
            if (publishError instanceof TimeoutError) {
                throw new SfdxError(
                    messages.getMessage('errorRegistryTimeout')
                );
            }
            // Registry error
            if (publishError instanceof RegistryError) {
                throw new SfdxError(
                    messages.getMessage('errorRegistryInternal', [
                        publishError.statusCode,
                        publishError.message
                    ])
                );
            }
            throw new SfdxError(
                messages.getMessage('errorUnknown', [publishError])
            );
        }

        // Return an object to be displayed with --json
        return pakageInfo;
    }
}
