# Implementation Plan: Query Pagination

## Overview

This implementation plan breaks down the cursor-based pagination feature for blockchain query methods into discrete coding tasks. The implementation will extend the existing NestJS backend with new paginated query methods and corresponding Soroban contract methods, while maintaining backward compatibility with existing query APIs.

## Tasks

- [ ] 1. Set up core pagination infrastructure
  - [ ] 1.1 Create cursor token management service
    - Implement CursorManager service with token generation, validation, and expiration
    - Add HMAC-SHA256 signing for cursor security
    - Create cursor token data structures and encoding/decoding logic
    - _Requirements: 2.1, 2.2, 2.5, 10.1, 10.3, 10.4, 10.5_

  - [ ]* 1.2 Write property test for cursor token integrity
    - **Property 3: Cursor Round-Trip Integrity**
    - **Validates: Requirements 2.2, 2.3**

  - [ ]* 1.3 Write property test for cursor security validation
    - **Property 5: Cursor Security and Validation**
    - **Validates: Requirements 2.5, 10.1, 10.3, 10.4, 10.5**

  - [ ] 1.4 Create paginated query base service
    - Implement PaginatedQueryService with common pagination logic
    - Add request validation for page size limits and parameter validation
    - Create paginated response builder with metadata
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.5 Write property test for bounded result sets
    - **Property 1: Bounded Result Sets**
    - **Validates: Requirements 1.1, 1.2, 9.2**

  - [ ]* 1.6 Write property test for page size validation
    - **Property 2: Page Size Validation**
    - **Validates: Requirements 1.3**

- [ ] 2. Implement inventory query pagination
  - [ ] 2.1 Create inventory pagination DTOs and interfaces
    - Define InventoryQueryRequest and PaginatedInventoryResponse types
    - Add validation decorators for blood_type, region, and cursor parameters
    - Create InventoryItem interface with required fields
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 2.2 Implement inventory query service method
    - Add queryInventoryPaginated method to PaginatedQueryService
    - Implement blood_type and region filtering logic
    - Add deterministic ordering by unit_id
    - Include total_count metadata in responses
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 3.1_

  - [ ]* 2.3 Write property test for inventory filter application
    - **Property 7: Filter Application Correctness (Inventory)**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 2.4 Write property test for inventory response schema
    - **Property 8: Response Schema Compliance (Inventory)**
    - **Validates: Requirements 4.4**

  - [ ] 2.5 Add inventory pagination controller endpoint
    - Create GET /blockchain/inventory/paginated endpoint
    - Add parameter validation and error handling
    - Integrate with cursor validation and response formatting
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 3. Implement request query pagination
  - [ ] 3.1 Create request pagination DTOs and interfaces
    - Define RequestQueryRequest and PaginatedRequestResponse types
    - Add validation for hospital_id, status, and cursor parameters
    - Create RequestItem interface with required fields
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 3.2 Implement request query service method
    - Add queryRequestsPaginated method to PaginatedQueryService
    - Implement hospital_id and status filtering logic
    - Add deterministic ordering by request_timestamp, then request_id
    - Include has_more metadata in responses
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 3.2_

  - [ ]* 3.3 Write property test for request filter application
    - **Property 7: Filter Application Correctness (Requests)**
    - **Validates: Requirements 5.2, 5.3**

  - [ ] 3.4 Add request pagination controller endpoint
    - Create GET /blockchain/requests/paginated endpoint
    - Add parameter validation and error handling
    - Integrate with cursor validation and response formatting
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 4. Implement dispute query pagination
  - [ ] 4.1 Create dispute pagination DTOs and interfaces
    - Define DisputeQueryRequest and PaginatedDisputeResponse types
    - Add validation for status, organization_id, date range, and cursor parameters
    - Create DisputeItem interface with required fields
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 4.2 Implement dispute query service method
    - Add queryDisputesPaginated method to PaginatedQueryService
    - Implement status, organization_id, and date range filtering logic
    - Add deterministic ordering by dispute_timestamp, then dispute_id
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 3.3_

  - [ ]* 4.3 Write property test for dispute filter application
    - **Property 7: Filter Application Correctness (Disputes)**
    - **Validates: Requirements 6.2, 6.3, 6.5**

  - [ ] 4.4 Add dispute pagination controller endpoint
    - Create GET /blockchain/disputes/paginated endpoint
    - Add parameter validation and error handling
    - Integrate with cursor validation and response formatting
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [ ] 5. Checkpoint - Core pagination services complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement custody trail pagination
  - [ ] 6.1 Create custody trail pagination DTOs and interfaces
    - Define TrailQueryRequest and PaginatedTrailResponse types
    - Add validation for unit_id and cursor parameters
    - Create TrailEvent interface with event type discrimination
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 6.2 Implement custody trail query service method
    - Add getUnitTrailPaginated method to PaginatedQueryService
    - Implement event grouping by type with chronological ordering
    - Add deterministic ordering by event_timestamp, then event_id
    - Handle custody transfers, temperature logs, and status changes
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 3.4_

  - [ ]* 6.3 Write property test for custody trail event grouping
    - **Property 11: Custody Trail Event Grouping**
    - **Validates: Requirements 7.5**

  - [ ] 6.4 Add custody trail pagination controller endpoint
    - Create GET /blockchain/units/:unitId/trail/paginated endpoint
    - Add parameter validation and error handling
    - Integrate with cursor validation and response formatting
    - _Requirements: 7.1_

- [ ] 7. Implement verification events pagination
  - [ ] 7.1 Create verification events pagination DTOs and interfaces
    - Define VerificationQueryRequest and PaginatedVerificationResponse types
    - Add validation for organization_id, event_type, and cursor parameters
    - Create VerificationEvent interface with metadata fields
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 7.2 Implement verification events query service method
    - Add getVerificationEventsPaginated method to PaginatedQueryService
    - Implement organization_id and event_type filtering logic
    - Add deterministic ordering by event_timestamp, then event_id
    - Handle null organization_id for all organizations
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 3.5_

  - [ ]* 7.3 Write property test for verification events filter application
    - **Property 7: Filter Application Correctness (Verification Events)**
    - **Validates: Requirements 8.3, 8.4**

  - [ ] 7.4 Add verification events pagination controller endpoint
    - Create GET /blockchain/verification-events/paginated endpoint
    - Add parameter validation and error handling
    - Integrate with cursor validation and response formatting
    - _Requirements: 8.1, 8.3, 8.4_

- [ ] 8. Implement Soroban contract pagination methods
  - [ ] 8.1 Add inventory pagination contract method
    - Implement query_inventory_paginated function in Rust
    - Add blood_type and region filtering with cursor support
    - Implement efficient storage scanning with ordering by unit_id
    - Return PaginatedInventoryResponse with proper error handling
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 3.1_

  - [ ] 8.2 Add request pagination contract method
    - Implement query_requests_paginated function in Rust
    - Add hospital_id and status filtering with cursor support
    - Implement ordering by request_timestamp, then request_id
    - Return PaginatedRequestResponse with proper error handling
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 3.2_

  - [ ] 8.3 Add dispute pagination contract method
    - Implement query_disputes_paginated function in Rust
    - Add status, organization_id, and date range filtering with cursor support
    - Implement ordering by dispute_timestamp, then dispute_id
    - Return PaginatedDisputeResponse with proper error handling
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 3.3_

  - [ ] 8.4 Add custody trail pagination contract method
    - Implement get_unit_trail_paginated function in Rust
    - Add unit_id filtering with cursor support and event grouping
    - Implement ordering by event_timestamp, then event_id
    - Return PaginatedTrailResponse with proper error handling
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 3.4_

  - [ ] 8.5 Add verification events pagination contract method
    - Implement get_verification_events_paginated function in Rust
    - Add organization_id and event_type filtering with cursor support
    - Implement ordering by event_timestamp, then event_id
    - Return PaginatedVerificationResponse with proper error handling
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 3.5_

- [ ] 9. Implement backward compatibility and deprecation
  - [ ] 9.1 Add deprecation warnings to existing query methods
    - Update existing query methods to log deprecation warnings
    - Limit existing methods to 100 results with truncation warnings
    - Add usage logging for migration monitoring
    - _Requirements: 9.1, 9.2, 9.4_

  - [ ]* 9.2 Write property test for legacy method compatibility
    - **Property 12: Legacy Method Compatibility**
    - **Validates: Requirements 9.1, 9.2, 9.4**

  - [ ] 9.3 Create migration documentation
    - Document migration paths from existing to paginated methods
    - Provide code examples for each query type
    - Create troubleshooting guide for common migration issues
    - _Requirements: 9.3_

- [ ] 10. Add comprehensive error handling
  - [ ] 10.1 Implement cursor validation error handling
    - Add specific error types for invalid, expired, and tampered cursors
    - Implement cross-query cursor usage detection and rejection
    - Add detailed error messages with troubleshooting guidance
    - _Requirements: 2.5, 10.2, 10.3, 10.4_

  - [ ] 10.2 Add query parameter validation error handling
    - Implement page size validation with appropriate error responses
    - Add filter parameter validation for each query type
    - Handle missing required parameters with clear error messages
    - _Requirements: 1.3_

  - [ ] 10.3 Add blockchain interaction error handling
    - Handle contract execution failures with retry guidance
    - Implement timeout handling with appropriate HTTP status codes
    - Add rate limiting error responses with retry-after headers
    - _Requirements: General error handling_

- [ ] 11. Checkpoint - Error handling and compatibility complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Add comprehensive property-based tests
  - [ ]* 12.1 Write property test for pagination metadata consistency
    - **Property 4: Pagination Metadata Consistency**
    - **Validates: Requirements 2.1, 2.4**

  - [ ]* 12.2 Write property test for deterministic ordering consistency
    - **Property 6: Deterministic Ordering Consistency**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [ ]* 12.3 Write property test for pagination metadata completeness
    - **Property 9: Pagination Metadata Completeness**
    - **Validates: Requirements 4.5, 5.5**

  - [ ]* 12.4 Write property test for cursor context binding
    - **Property 10: Cursor Context Binding**
    - **Validates: Requirements 10.2**

  - [ ]* 12.5 Write property test for empty result handling
    - **Property 13: Empty Result Handling**
    - **Validates: Requirements 1.4**

- [ ] 13. Integration and wiring
  - [ ] 13.1 Wire pagination services into blockchain module
    - Register CursorManager and PaginatedQueryService in blockchain module
    - Configure cursor token signing keys and expiration settings
    - Add pagination-specific configuration options
    - _Requirements: All requirements_

  - [ ] 13.2 Update blockchain controller with pagination endpoints
    - Register all paginated query endpoints in blockchain controller
    - Add global error handling for pagination-specific errors
    - Configure request validation and response formatting
    - _Requirements: All requirements_

  - [ ]* 13.3 Write integration tests for end-to-end pagination flows
    - Test complete pagination flows from HTTP request to blockchain response
    - Validate cursor generation, validation, and usage across multiple pages
    - Test error scenarios and edge cases in realistic conditions
    - _Requirements: All requirements_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Implementation uses TypeScript for backend services and Rust for Soroban contracts
- Checkpoints ensure incremental validation and provide opportunities for user feedback
- Integration tests validate end-to-end functionality across the entire pagination system