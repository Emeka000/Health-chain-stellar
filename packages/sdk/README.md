# @medchain/sdk

TypeScript SDK for the Healthy-Stellar health donor protocol.

## Installation

\`\`\`bash
npm install @medchain/sdk
\`\`\`

## Usage Example

\`\`\`typescript
import { RecordsApi, Configuration } from '@medchain/sdk';

const config = new Configuration({
  basePath: 'http://localhost:3000/api/v1',
  accessToken: 'YOUR_TOKEN'
});

const recordsApi = new RecordsApi(config);

// Example: Fetching records
// recordsApi.recordsGet().then(res => console.log(res.data));
\`\`\`

## Development

To regenerate the SDK after changing the OpenAPI spec:
1. Update \`backend/docs/openapi.json\`
2. Run \`npm run generate\`
3. Run \`npm run build\`
