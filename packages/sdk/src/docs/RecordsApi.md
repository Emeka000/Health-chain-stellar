# RecordsApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**recordsGet**](#recordsget) | **GET** /records | Get all health records|
|[**recordsPost**](#recordspost) | **POST** /records | Upload a health record|

# **recordsGet**
> recordsGet()


### Example

```typescript
import {
    RecordsApi,
    Configuration
} from '@medchain/sdk';

const configuration = new Configuration();
const apiInstance = new RecordsApi(configuration);

const { status, data } = await apiInstance.recordsGet();
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
|**200** | Success |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **recordsPost**
> recordsPost()


### Example

```typescript
import {
    RecordsApi,
    Configuration
} from '@medchain/sdk';

const configuration = new Configuration();
const apiInstance = new RecordsApi(configuration);

const { status, data } = await apiInstance.recordsPost();
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
|**201** | Created |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

