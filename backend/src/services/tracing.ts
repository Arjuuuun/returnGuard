import { NodeSDK } from '@opentelemetry/sdk-node';
import { AzureMonitorTraceExporter } from '@azure/monitor-opentelemetry-exporter';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const exporter = new AzureMonitorTraceExporter({
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
});

const sdk = new NodeSDK({
    traceExporter: exporter,
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'returnguard-function',
    }),
});

sdk.start();

console.log('OpenTelemetry tracing initialized');