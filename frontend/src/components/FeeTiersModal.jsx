import React, { useState, useEffect } from 'react';
import { X, Settings, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { botsApi } from '../services/api';

const FeeTiersModal = ({ 
    isOpen, 
    onClose, 
    botId, 
    selectedCoin, 
    initialTiers = [], 
    onSave 
}) => {
    const [currentTiers, setCurrentTiers] = useState([]);
    const [savingTiers, setSavingTiers] = useState(false);
    const [validationErrors, setValidationErrors] = useState([]);
    const [focusedField, setFocusedField] = useState(null);

    // Client-side validation for tiers
    const validateTiersClientSide = (tiers) => {
        const errors = [];
        
        if (tiers.length === 0) {
            return { valid: true, errors: [] };
        }
        
        // Normalize tiers - ensure all numeric values are properly converted
        const normalizedTiers = tiers.map(tier => ({
            ...tier,
            min_amount: typeof tier.min_amount === 'number' ? tier.min_amount : parseFloat(tier.min_amount) || 0,
            max_amount: tier.max_amount === null || tier.max_amount === undefined || tier.max_amount === '' ? 
                       null : (typeof tier.max_amount === 'number' ? tier.max_amount : parseFloat(tier.max_amount)),
            buy_fee: typeof tier.buy_fee === 'number' ? tier.buy_fee : parseFloat(tier.buy_fee) || 0,
            sell_fee: typeof tier.sell_fee === 'number' ? tier.sell_fee : parseFloat(tier.sell_fee) || 0
        }));
        
        // Sort tiers by min_amount
        const sortedTiers = [...normalizedTiers].sort((a, b) => a.min_amount - b.min_amount);
        
        // Check individual tier validity and overlaps
        for (let i = 0; i < sortedTiers.length; i++) {
            const tier = sortedTiers[i];
            const nextTier = sortedTiers[i + 1];
            
            // Validate current tier
            if (isNaN(tier.min_amount) || tier.min_amount < 0) {
                errors.push(`Диапазон ${i + 1}: Минимальная сумма должна быть неотрицательным числом`);
                continue;
            }
            
            if (tier.max_amount !== null && (isNaN(tier.max_amount) || tier.max_amount <= tier.min_amount)) {
                errors.push(`Диапазон ${i + 1}: Максимальная сумма должна быть больше минимальной`);
                continue;
            }
            
            // Check for overlaps and gaps only if there are multiple tiers
            if (nextTier && sortedTiers.length > 1) {
                if (tier.max_amount === null) {
                    errors.push(`Диапазон ${i + 1}: Нельзя иметь безлимитный диапазон, если есть последующие диапазоны`);
                } else if (Math.abs(tier.max_amount - nextTier.min_amount) > 0.001) { // Allow for floating point precision issues
                    if (tier.max_amount < nextTier.min_amount) {
                        errors.push(`Пробел между диапазоном ${i + 1} и ${i + 2}: ${tier.max_amount.toFixed(2)} до ${nextTier.min_amount.toFixed(2)}`);
                    } else {
                        errors.push(`Пересечение между диапазоном ${i + 1} и ${i + 2}`);
                    }
                }
            }
        }
        
        return { valid: errors.length === 0, errors };
    };

    useEffect(() => {
        if (isOpen) {
            setCurrentTiers(initialTiers);
            // Clear validation errors when opening
            setValidationErrors([]);
        }
    }, [isOpen, initialTiers]);

    const handleAddFeeTier = () => {
        // Calculate smart default values to avoid gaps
        let newMinAmount = 0;
        if (currentTiers.length > 0) {
            // Sort tiers by min_amount to find the highest end point
            const sortedTiers = [...currentTiers].sort((a, b) => a.min_amount - b.min_amount);
            const lastTier = sortedTiers[sortedTiers.length - 1];
            if (lastTier.max_amount === null || lastTier.max_amount === undefined || lastTier.max_amount === '') {
                toast.error('\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0443\u043a\u0430\u0436\u0438\u0442\u0435 \u0432\u0435\u0440\u0445\u043d\u044e\u044e \u0433\u0440\u0430\u043d\u0438\u0446\u0443 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0433\u043e \u0434\u0438\u0430\u043f\u0430\u0437\u043e\u043d\u0430');
                return;
            }
            newMinAmount = Number(lastTier.max_amount);
        }

        const newTier = {
            id: null,
            coin: selectedCoin,
            min_amount: newMinAmount,
            max_amount: null,
            buy_fee: 0,
            sell_fee: 0
        };
        const updatedTiers = [...currentTiers, newTier];
        setCurrentTiers(updatedTiers);
        
        // Clear validation errors when adding new tier
        setValidationErrors([]);
    };

    const handleUpdateFeeTier = (index, field, value) => {
        const updatedTiers = [...currentTiers];
        updatedTiers[index] = { ...updatedTiers[index], [field]: value };
        setCurrentTiers(updatedTiers);
        
        // Clear validation errors when user is editing (they'll be shown when validating)
        if (validationErrors.length > 0) {
            setValidationErrors([]);
        }
    };

    const handleDeleteFeeTier = (index) => {
        const updatedTiers = currentTiers.filter((_, i) => i !== index);
        setCurrentTiers(updatedTiers);
        
        // Clear validation errors when deleting tier
        setValidationErrors([]);
    };

    // Helper function to parse numbers with comma as decimal separator
    const parseNumber = (value) => {
        if (typeof value === 'number') return value;
        if (!value || value === '') return null;
        
        // Replace comma with dot for parsing
        const normalized = value.toString().replace(',', '.');
        const parsed = parseFloat(normalized);
        return isNaN(parsed) ? null : parsed;
    };

    // Helper function to format numbers for display
    const formatNumberForDisplay = (value) => {
        if (value === null || value === undefined || value === '') return '';
        const num = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(num)) return '';
        return num.toFixed(2);
    };

    const handleSaveFeeTiers = async () => {
        setSavingTiers(true);
        try {
            // Validate tiers on client side before saving
            const validationResult = validateTiersClientSide(currentTiers);
            if (!validationResult.valid) {
                toast.error(`Ошибка валидации: ${validationResult.errors.join('; ')}`);
                return;
            }

            // Normalize tiers before sending to server - convert strings to numbers
            const normalizedTiers = currentTiers.map(tier => {
                const minAmount = parseNumber(tier.min_amount);
                const maxAmount = tier.max_amount === null || tier.max_amount === '' || tier.max_amount === undefined ? 
                                 null : parseNumber(tier.max_amount);
                const buyFee = parseNumber(tier.buy_fee);
                const sellFee = parseNumber(tier.sell_fee);

                // Ensure min_amount is a valid number
                if (minAmount === null || isNaN(minAmount)) {
                    throw new Error('Минимальная сумма должна быть числом');
                }

                const normalized = {
                    coin: selectedCoin,
                    min_amount: minAmount,
                    max_amount: maxAmount,
                    buy_fee: buyFee || 0,
                    sell_fee: sellFee || 0
                };

                // Only include id if it exists (for updates)
                if (tier.id) {
                    normalized.id = tier.id;
                    normalized.bot_id = tier.bot_id;
                }

                return normalized;
            });

            // Debug: log what we're sending
            console.log('Sending to server:', {
                coin: selectedCoin,
                tiers: normalizedTiers
            });

            // Use the new bulk API to replace all tiers for this coin atomically
            await botsApi.bulkUpdateFeeTiers(botId, {
                coin: selectedCoin,
                tiers: normalizedTiers
            });

            onSave?.();
            onClose();
            toast.success('Диапазоны комиссий сохранены');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Ошибка при сохранении диапазонов');
        } finally {
            setSavingTiers(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
                            <Settings className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                                Диапазоны комиссий для {selectedCoin}
                            </h2>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Настройка прогрессивной системы комиссий
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Modal Content */}
                <div className="p-6 max-h-[70vh] overflow-y-auto">
                    <div className="space-y-6">
                        {/* Info */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/30 rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                                Как работают диапазоны комиссий
                            </h3>
                            <p className="text-sm text-blue-700 dark:text-blue-400">
                                Система автоматически применяет разные комиссии в зависимости от суммы заявки. 
                                Например: до 10,000₽ — 2.5%, свыше 10,000₽ — 1.5%.
                                <br />
                                <strong>Важно:</strong> Диапазоны не должны пересекаться и иметь пробелы между ними.
                                Если диапазоны не настроены, используются общие комиссии.
                            </p>
                        </div>

                        {/* Validation Errors */}
                        {validationErrors.length > 0 && (
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 rounded-xl p-4">
                                <h3 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                                    Ошибки валидации
                                </h3>
                                <ul className="text-sm text-red-700 dark:text-red-400 space-y-1">
                                    {validationErrors.map((error, index) => (
                                        <li key={index}>• {error}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Validation Helper */}
                        {currentTiers.length > 0 && validationErrors.length === 0 && (
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/30 rounded-xl p-4">
                                <p className="text-sm text-green-700 dark:text-green-400">
                                    ✓ Диапазоны настроены корректно
                                </p>
                            </div>
                        )}

                        {/* Tier List */}
                        <div className="space-y-4">
                            {currentTiers.map((tier, index) => (
                                <div key={index} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-gray-200 dark:border-gray-600">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                            Диапазон {index + 1}
                                        </h4>
                                        <button
                                            onClick={() => handleDeleteFeeTier(index)}
                                            className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        {/* Min Amount */}
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                                От суммы (₽)
                                            </label>
                                            <input
                                                type="text"
                                                value={tier.min_amount || ''}
                                                onChange={(e) => {
                                                    handleUpdateFeeTier(index, 'min_amount', e.target.value);
                                                }}
                                                placeholder="0"
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            />
                                        </div>

                                        {/* Max Amount */}
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                                До суммы (₽)
                                            </label>
                                            <input
                                                type="text"
                                                value={tier.max_amount !== null ? tier.max_amount : ''}
                                                onChange={(e) => {
                                                    handleUpdateFeeTier(index, 'max_amount', e.target.value || null);
                                                }}
                                                placeholder="Без ограничений"
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            />
                                        </div>

                                        {/* Buy Fee */}
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                                Комиссия покупки (%)
                                            </label>
                                            <input
                                                type="text"
                                                value={tier.buy_fee * 100}
                                                onChange={(e) => {
                                                    const value = parseNumber(e.target.value);
                                                    handleUpdateFeeTier(index, 'buy_fee', (value !== null ? value : 0) / 100);
                                                }}
                                                placeholder="0"
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            />
                                        </div>

                                        {/* Sell Fee */}
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                                Комиссия продажи (%)
                                            </label>
                                            <input
                                                type="text"
                                                value={tier.sell_fee * 100}
                                                onChange={(e) => {
                                                    const value = parseNumber(e.target.value);
                                                    handleUpdateFeeTier(index, 'sell_fee', (value !== null ? value : 0) / 100);
                                                }}
                                                placeholder="0"
                                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Add Tier Button */}
                            <button
                                onClick={handleAddFeeTier}
                                className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-gray-500 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center justify-center gap-2"
                            >
                                <Plus className="w-5 h-5" />
                                Добавить диапазон
                            </button>

                            {/* Validate Button */}
                            {currentTiers.length > 0 && (
                                <button
                                    onClick={() => {
                                        const validation = validateTiersClientSide(currentTiers);
                                        setValidationErrors(validation.errors);
                                    }}
                                    className="w-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl p-3 text-sm font-medium transition-colors"
                                >
                                    Проверить корректность диапазонов
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium transition-colors"
                    >
                        Отмена
                    </button>
                    <button
                        onClick={handleSaveFeeTiers}
                        disabled={savingTiers || validationErrors.length > 0}
                        className="px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {savingTiers ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Сохранение...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Сохранить
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FeeTiersModal;
