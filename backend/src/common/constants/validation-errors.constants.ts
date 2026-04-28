/**
 * Backend Validation Error Message Codes
 * These codes are machine-readable and map to frontend translations
 * Format: SCOPE_FIELD_ERROR_TYPE
 */

export const ValidationErrorCodes = {
  // Blood Requests
  BLOOD_REQUEST_INVALID_HOSPITAL_ID: 'blood_request_invalid_hospital_id',
  BLOOD_REQUEST_REQUIRED_BY_MUST_BE_FUTURE: 'blood_request_required_by_must_be_future',
  BLOOD_REQUEST_NO_ITEMS: 'blood_request_no_items',
  BLOOD_REQUEST_INVALID_URGENCY: 'blood_request_invalid_urgency',
  BLOOD_REQUEST_INVALID_DELIVERY_ADDRESS: 'blood_request_invalid_delivery_address',

  // Blood Units
  BLOOD_UNIT_INVALID_TYPE: 'blood_unit_invalid_type',
  BLOOD_UNIT_INVALID_QUANTITY: 'blood_unit_invalid_quantity',
  BLOOD_UNIT_EXPIRED: 'blood_unit_expired',
  BLOOD_UNIT_NOT_FOUND: 'blood_unit_not_found',
  BLOOD_UNIT_INSUFFICIENT_STOCK: 'blood_unit_insufficient_stock',

  // Orders
  ORDER_INVALID_BLOOD_BANK: 'order_invalid_blood_bank',
  ORDER_INVALID_STATUS: 'order_invalid_status',
  ORDER_NOT_FOUND: 'order_not_found',
  ORDER_ALREADY_DISPATCHED: 'order_already_dispatched',
  ORDER_CANNOT_CANCEL: 'order_cannot_cancel',

  // Dispatch
  DISPATCH_INVALID_RIDER: 'dispatch_invalid_rider',
  DISPATCH_INVALID_VEHICLE: 'dispatch_invalid_vehicle',
  DISPATCH_TEMPERATURE_OUT_OF_RANGE: 'dispatch_temperature_out_of_range',
  DISPATCH_NOT_FOUND: 'dispatch_not_found',

  // Verification
  VERIFICATION_INVALID_BLOOD_ID: 'verification_invalid_blood_id',
  VERIFICATION_UNIT_NOT_FOUND: 'verification_unit_not_found',
  VERIFICATION_UNIT_EXPIRED: 'verification_unit_expired',
  VERIFICATION_INVALID_CONDITION: 'verification_invalid_condition',

  // Generic
  VALIDATION_ERROR: 'validation_error',
  REQUIRED_FIELD: 'required_field',
  INVALID_FORMAT: 'invalid_format',
  INVALID_ENUM: 'invalid_enum',
  INVALID_LENGTH: 'invalid_length',
  INVALID_DATE: 'invalid_date',
  INVALID_NUMBER: 'invalid_number',
  DUPLICATE_ENTRY: 'duplicate_entry',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
};

/**
 * Error message templates with placeholders
 * Placeholders: {field}, {value}, {min}, {max}, {expected}, {actual}
 */
export const ErrorMessageTemplates: Record<string, { en: string; fr: string }> = {
  // Blood Requests
  [ValidationErrorCodes.BLOOD_REQUEST_INVALID_HOSPITAL_ID]: {
    en: 'Invalid hospital ID: {value}',
    fr: 'ID hôpital invalide : {value}',
  },
  [ValidationErrorCodes.BLOOD_REQUEST_REQUIRED_BY_MUST_BE_FUTURE]: {
    en: 'Required delivery date must be in the future',
    fr: 'La date de livraison requise doit être dans le futur',
  },
  [ValidationErrorCodes.BLOOD_REQUEST_NO_ITEMS]: {
    en: 'Blood request must contain at least one item',
    fr: 'La demande de sang doit contenir au moins un article',
  },
  [ValidationErrorCodes.BLOOD_REQUEST_INVALID_URGENCY]: {
    en: 'Invalid urgency level: {value}',
    fr: 'Niveau d\'urgence invalide : {value}',
  },
  [ValidationErrorCodes.BLOOD_REQUEST_INVALID_DELIVERY_ADDRESS]: {
    en: 'Delivery address must not exceed 500 characters',
    fr: 'L\'adresse de livraison ne doit pas dépasser 500 caractères',
  },

  // Blood Units
  [ValidationErrorCodes.BLOOD_UNIT_INVALID_TYPE]: {
    en: 'Invalid blood type: {value}',
    fr: 'Groupe sanguin invalide : {value}',
  },
  [ValidationErrorCodes.BLOOD_UNIT_INVALID_QUANTITY]: {
    en: 'Quantity must be a positive number, got: {value}',
    fr: 'La quantité doit être un nombre positif, reçu : {value}',
  },
  [ValidationErrorCodes.BLOOD_UNIT_EXPIRED]: {
    en: 'Blood unit has expired (expiry date: {value})',
    fr: 'L\'unité de sang a expiré (date d\'expiration : {value})',
  },
  [ValidationErrorCodes.BLOOD_UNIT_NOT_FOUND]: {
    en: 'Blood unit not found: {value}',
    fr: 'Unité de sang non trouvée : {value}',
  },
  [ValidationErrorCodes.BLOOD_UNIT_INSUFFICIENT_STOCK]: {
    en: 'Insufficient stock. Available: {actual}, Requested: {expected}',
    fr: 'Stock insuffisant. Disponible : {actual}, Demandé : {expected}',
  },

  // Orders
  [ValidationErrorCodes.ORDER_INVALID_BLOOD_BANK]: {
    en: 'Selected blood bank is not available',
    fr: 'La banque de sang sélectionnée n\'est pas disponible',
  },
  [ValidationErrorCodes.ORDER_INVALID_STATUS]: {
    en: 'Invalid order status: {value}',
    fr: 'Statut de commande invalide : {value}',
  },
  [ValidationErrorCodes.ORDER_NOT_FOUND]: {
    en: 'Order not found: {value}',
    fr: 'Commande non trouvée : {value}',
  },
  [ValidationErrorCodes.ORDER_ALREADY_DISPATCHED]: {
    en: 'Order has already been dispatched',
    fr: 'La commande a déjà été expédiée',
  },
  [ValidationErrorCodes.ORDER_CANNOT_CANCEL]: {
    en: 'Cannot cancel order with status: {value}',
    fr: 'Impossible d\'annuler la commande avec le statut : {value}',
  },

  // Dispatch
  [ValidationErrorCodes.DISPATCH_INVALID_RIDER]: {
    en: 'Selected rider is not available',
    fr: 'Le livreur sélectionné n\'est pas disponible',
  },
  [ValidationErrorCodes.DISPATCH_INVALID_VEHICLE]: {
    en: 'Selected vehicle is not available',
    fr: 'Le véhicule sélectionné n\'est pas disponible',
  },
  [ValidationErrorCodes.DISPATCH_TEMPERATURE_OUT_OF_RANGE]: {
    en: 'Temperature is outside safe range (1-10°C). Current: {value}°C',
    fr: 'La température est en dehors de la plage sûre (1-10°C). Actuelle : {value}°C',
  },
  [ValidationErrorCodes.DISPATCH_NOT_FOUND]: {
    en: 'Dispatch not found: {value}',
    fr: 'Livraison non trouvée : {value}',
  },

  // Verification
  [ValidationErrorCodes.VERIFICATION_INVALID_BLOOD_ID]: {
    en: 'Invalid blood unit ID format',
    fr: 'Format d\'ID d\'unité de sang invalide',
  },
  [ValidationErrorCodes.VERIFICATION_UNIT_NOT_FOUND]: {
    en: 'Blood unit not found: {value}',
    fr: 'Unité de sang non trouvée : {value}',
  },
  [ValidationErrorCodes.VERIFICATION_UNIT_EXPIRED]: {
    en: 'Blood unit has expired',
    fr: 'L\'unité de sang a expiré',
  },
  [ValidationErrorCodes.VERIFICATION_INVALID_CONDITION]: {
    en: 'Invalid condition status: {value}',
    fr: 'État de condition invalide : {value}',
  },

  // Generic
  [ValidationErrorCodes.REQUIRED_FIELD]: {
    en: '{field} is required',
    fr: '{field} est obligatoire',
  },
  [ValidationErrorCodes.INVALID_FORMAT]: {
    en: '{field} has invalid format',
    fr: '{field} a un format invalide',
  },
  [ValidationErrorCodes.INVALID_ENUM]: {
    en: '{field} must be one of: {expected}',
    fr: '{field} doit être l\'un des : {expected}',
  },
  [ValidationErrorCodes.INVALID_LENGTH]: {
    en: '{field} must be between {min} and {max} characters',
    fr: '{field} doit contenir entre {min} et {max} caractères',
  },
  [ValidationErrorCodes.INVALID_DATE]: {
    en: '{field} must be a valid date',
    fr: '{field} doit être une date valide',
  },
  [ValidationErrorCodes.INVALID_NUMBER]: {
    en: '{field} must be a valid number',
    fr: '{field} doit être un nombre valide',
  },
  [ValidationErrorCodes.DUPLICATE_ENTRY]: {
    en: '{field} already exists',
    fr: '{field} existe déjà',
  },
  [ValidationErrorCodes.UNAUTHORIZED]: {
    en: 'You are not authorized to perform this action',
    fr: 'Vous n\'êtes pas autorisé à effectuer cette action',
  },
  [ValidationErrorCodes.FORBIDDEN]: {
    en: 'Access denied',
    fr: 'Accès refusé',
  },
  [ValidationErrorCodes.NOT_FOUND]: {
    en: 'Resource not found: {value}',
    fr: 'Ressource non trouvée : {value}',
  },
};

/**
 * Interface for validation error response
 */
export interface ValidationErrorResponse {
  errorCode: string;
  message: string;
  field?: string;
  constraints?: Record<string, any>;
}

/**
 * Interface for paginated validation errors
 */
export interface ValidationErrorsResponse {
  statusCode: number;
  message: string;
  errors: ValidationErrorResponse[];
  timestamp: string;
}
