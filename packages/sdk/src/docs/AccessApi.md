# AccessApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**accessGrantPost**](#accessgrantpost) | **POST** /access/grant | Grant record access|

# **accessGrantPost**
> accessGrantPost()


### Example

```typescript
import {
    AccessApi,
    Configuration
} from '@medchain/sdk';

const configuration = new Configuration();
const apiInstance = new AccessApi(configuration);

const { status, data } = await apiInstance.accessGrantPost();
```

### Parameters
This endpoint does not have any parameters.


### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Access Granted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

