/**
 * Accessible Map Alternative Component
 * 
 * Provides text-based alternative for map interactions
 */

import React, { useState } from 'react';
import { KeyboardNavigableList } from './KeyboardNavigableList';

export interface MapLocation {
    id: string;
    name: string;
    address: string;
    distance?: number;
    coordinates?: {
        lat: number;
        lng: number;
    };
}

export interface AccessibleMapAlternativeProps {
    /** Available locations */
    locations: MapLocation[];

    /** Selected location ID */
    selectedLocationId?: string;

    /** Selection change handler */
    onLocationSelect: (location: MapLocation) => void;

    /** Whether to show map view */
    showMap?: boolean;

    /** Toggle map view */
    onToggleMapView?: () => void;

    /** Custom class name */
    className?: string;
}

export const AccessibleMapAlternative: React.FC<AccessibleMapAlternativeProps> = ({
    locations,
    selectedLocationId,
    onLocationSelect,
    showMap = false,
    onToggleMapView,
    className = '',
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    // Filter locations by search query
    const filteredLocations = locations.filter(
        (location) =>
            location.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            location.address.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const selectedIndex = filteredLocations.findIndex(
        (loc) => loc.id === selectedLocationId,
    );

    const handleLocationSelect = (index: number, location: MapLocation) => {
        onLocationSelect(location);
    };

    const handleLocationActivate = (index: number, location: MapLocation) => {
        onLocationSelect(location);
    };

    return (
        <div className={`space-y-4 ${className}`}>
            {/* View toggle */}
            {onToggleMapView && (
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Select Location</h3>
                    <button
                        type="button"
                        onClick={onToggleMapView}
                        className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                        aria-pressed={showMap}
                    >
                        {showMap ? 'Show List View' : 'Show Map View'}
                    </button>
                </div>
            )}

            {/* Search input */}
            <div>
                <label htmlFor="location-search" className="sr-only">
                    Search locations
                </label>
                <input
                    id="location-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or address..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Search locations"
                />
            </div>

            {/* Results count */}
            <div className="text-sm text-gray-600" role="status" aria-live="polite">
                {filteredLocations.length === 0
                    ? 'No locations found'
                    : `${filteredLocations.length} location${filteredLocations.length === 1 ? '' : 's'} found`}
            </div>

            {/* Location list */}
            {filteredLocations.length > 0 && (
                <KeyboardNavigableList
                    items={filteredLocations}
                    selectedIndex={selectedIndex >= 0 ? selectedIndex : 0}
                    onSelectionChange={handleLocationSelect}
                    onItemActivate={handleLocationActivate}
                    ariaLabel="Available locations"
                    className="border border-gray-300 rounded-md divide-y max-h-96 overflow-y-auto"
                    renderItem={(location, index, isSelected) => (
                        <div
                            className={`p-4 ${isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <h4 className="font-semibold text-gray-900">
                                        {location.name}
                                    </h4>
                                    <p className="text-sm text-gray-600 mt-1">
                                        {location.address}
                                    </p>
                                    {location.distance !== undefined && (
                                        <p className="text-sm text-gray-500 mt-1">
                                            {location.distance.toFixed(1)} km away
                                        </p>
                                    )}
                                </div>
                                {isSelected && (
                                    <span className="ml-2 text-blue-600" aria-label="Selected">
                                        <svg
                                            className="w-6 h-6"
                                            fill="currentColor"
                                            viewBox="0 0 20 20"
                                            aria-hidden="true"
                                        >
                                            <path
                                                fillRule="evenodd"
                                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                clipRule="evenodd"
                                            />
                                        </svg>
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                />
            )}

            {/* Instructions */}
            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                <p className="font-semibold mb-1">Keyboard navigation:</p>
                <ul className="list-disc list-inside space-y-1">
                    <li>Use Arrow keys to navigate between locations</li>
                    <li>Press Enter or Space to select a location</li>
                    <li>Press Home to go to first location</li>
                    <li>Press End to go to last location</li>
                </ul>
            </div>
        </div>
    );
};

export default AccessibleMapAlternative;
