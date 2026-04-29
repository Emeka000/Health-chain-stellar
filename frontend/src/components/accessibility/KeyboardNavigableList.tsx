/**
 * Keyboard Navigable List Component
 * 
 * List with full keyboard navigation support (arrow keys, home, end)
 */

import React, { useRef, useCallback, useEffect } from 'react';

export interface KeyboardNavigableListProps<T> {
    /** List items */
    items: T[];

    /** Render function for each item */
    renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;

    /** Selected index */
    selectedIndex?: number;

    /** Selection change handler */
    onSelectionChange?: (index: number, item: T) => void;

    /** Item activation handler (Enter/Space) */
    onItemActivate?: (index: number, item: T) => void;

    /** Custom class name */
    className?: string;

    /** ARIA label for the list */
    ariaLabel: string;

    /** Whether list is multi-selectable */
    multiSelectable?: boolean;

    /** Orientation of the list */
    orientation?: 'vertical' | 'horizontal';
}

export function KeyboardNavigableList<T>({
    items,
    renderItem,
    selectedIndex = 0,
    onSelectionChange,
    onItemActivate,
    className = '',
    ariaLabel,
    multiSelectable = false,
    orientation = 'vertical',
}: KeyboardNavigableListProps<T>) {
    const listRef = useRef<HTMLUListElement>(null);
    const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

    // Focus selected item
    useEffect(() => {
        if (selectedIndex >= 0 && selectedIndex < items.length) {
            itemRefs.current[selectedIndex]?.focus();
        }
    }, [selectedIndex, items.length]);

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent, index: number) => {
            const isVertical = orientation === 'vertical';
            const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';
            const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';

            let newIndex = index;

            switch (event.key) {
                case nextKey:
                    event.preventDefault();
                    newIndex = Math.min(index + 1, items.length - 1);
                    break;

                case prevKey:
                    event.preventDefault();
                    newIndex = Math.max(index - 1, 0);
                    break;

                case 'Home':
                    event.preventDefault();
                    newIndex = 0;
                    break;

                case 'End':
                    event.preventDefault();
                    newIndex = items.length - 1;
                    break;

                case 'Enter':
                case ' ':
                    event.preventDefault();
                    onItemActivate?.(index, items[index]);
                    return;

                default:
                    return;
            }

            if (newIndex !== index) {
                onSelectionChange?.(newIndex, items[newIndex]);
            }
        },
        [items, onSelectionChange, onItemActivate, orientation],
    );

    const handleClick = useCallback(
        (index: number) => {
            onSelectionChange?.(index, items[index]);
        },
        [items, onSelectionChange],
    );

    return (
        <ul
            ref={listRef}
            className={`focus:outline-none ${className}`}
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable={multiSelectable}
            aria-orientation={orientation}
        >
            {items.map((item, index) => {
                const isSelected = index === selectedIndex;

                return (
                    <li
                        key={index}
                        ref={(el) => (itemRefs.current[index] = el)}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={isSelected ? 0 : -1}
                        className={`
              cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500
              ${isSelected ? 'bg-blue-100' : 'hover:bg-gray-100'}
            `}
                        onClick={() => handleClick(index)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                    >
                        {renderItem(item, index, isSelected)}
                    </li>
                );
            })}
        </ul>
    );
}

export default KeyboardNavigableList;
