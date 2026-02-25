import { AuthApi, RecordsApi, AccessApi, Configuration } from '../src';

async function fullFlow() {
  const config = new Configuration({
    basePath: 'http://localhost:3000/api/v1',
    accessToken: 'mock_token'
  });

  const auth = new AuthApi(config);
  const records = new RecordsApi(config);
  const access = new AccessApi(config);

  console.log("--- Starting MedChain SDK Flow ---");

  // 1. Upload
  console.log("Step 1: Uploading record...");
  // await records.recordsPost();

  // 2. Grant
  console.log("Step 2: Granting access...");
  // await access.accessGrantPost();

  // 3. Fetch
  console.log("Step 3: Fetching records...");
  const res = await records.recordsGet();
  console.log("Flow complete. Status:", res.status);
}

fullFlow().catch(console.error);
