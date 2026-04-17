import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { botsApi, ordersApi } from '../services/api';
import { CreditCard, Smartphone, Wallet, Bitcoin, AlertCircle, User, Building2, Hash, Plus } from 'lucide-react';

const BotRequisiteForm = ({ botId, orderId, onSuccess, supportId, operationType, coin }) => {
    // Определяем тип реквизита на основе операции и валюты
    const getRequisiteType = () => {
        if (operationType === 'BUY') {
            // При покупке - банковская карта или СБП (пользователь платит рублями)
            return 'SBP'; // По умолчанию СБП, при необходимости можно переключить на карту
        } else {
            // При продаже - кошелек соответствующей валюты
            return coin; // BTC, LTC, XMR, USDT
        }
    };

    const [paymentMethod, setPaymentMethod] = useState('sbp'); // 'sbp' или 'card'
    const requisiteType = operationType === 'BUY' ? (paymentMethod === 'sbp' ? 'SBP' : 'CARD') : getRequisiteType();

    const [formData, setFormData] = useState({
        type: requisiteType,
        label: '',
        address: '',
        bank_name: '', 
        holder_name: '',
        support_id: supportId
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Создаем реквизит в bot_requisites и назначаем его заявке в одном запросе
            const requisiteResponse = await botsApi.createBotRequisite(botId, {
                ...formData,
                support_id: supportId,
                order_id: orderId // Передаем ID заявки для автоматического назначения
            });

            toast.success('Реквизиты успешно добавлены');
            onSuccess(requisiteResponse.data);
            
            // Очищаем форму, но сохраняем правильный тип
            setFormData({
                type: requisiteType,
                label: '',
                address: '',
                bank_name: '',
                holder_name: '',
                support_id: supportId
            });
        } catch (error) {
            console.error('Failed to create requisite:', error);
            const errorMessage = error.response?.data?.error || error.message || 'Ошибка при добавлении реквизита';
            toast.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {/* Payment Method Selection */}
            {operationType === 'BUY' && (
                <div className="relative">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        <Wallet className="w-4 h-4 text-blue-500" />
                        Способ оплаты
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className={`order-2 relative flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                            paymentMethod === 'card'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md'
                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600'
                        }`}>
                            <input
                                type="radio"
                                value="card"
                                checked={paymentMethod === 'card'}
                                onChange={(e) => {
                                    setPaymentMethod(e.target.value);
                                    setFormData({ ...formData, type: 'CARD' });
                                }}
                                className="sr-only"
                            />
                            <div className={`p-2 rounded-lg ${
                                paymentMethod === 'card' 
                                    ? 'bg-blue-500' 
                                    : 'bg-gray-100 dark:bg-gray-700'
                            }`}>
                                <CreditCard className={`w-5 h-5 ${
                                    paymentMethod === 'card' 
                                        ? 'text-white' 
                                        : 'text-gray-500 dark:text-gray-400'
                                }`} />
                            </div>
                            <span className={`text-sm font-semibold ${
                                paymentMethod === 'card'
                                    ? 'text-blue-700 dark:text-blue-400'
                                    : 'text-gray-700 dark:text-gray-300'
                            }`}>
                                Банковская карта
                            </span>
                        </label>
                        <label className={`order-1 relative flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                            paymentMethod === 'sbp'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md'
                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600'
                        }`}>
                            <input
                                type="radio"
                                value="sbp"
                                checked={paymentMethod === 'sbp'}
                                onChange={(e) => {
                                    setPaymentMethod(e.target.value);
                                    setFormData({ ...formData, type: 'SBP' });
                                }}
                                className="sr-only"
                            />
                            <div className={`p-2 rounded-lg ${
                                paymentMethod === 'sbp' 
                                    ? 'bg-blue-500' 
                                    : 'bg-gray-100 dark:bg-gray-700'
                            }`}>
                                <Smartphone className={`w-5 h-5 ${
                                    paymentMethod === 'sbp' 
                                        ? 'text-white' 
                                        : 'text-gray-500 dark:text-gray-400'
                                }`} />
                            </div>
                            <span className={`text-sm font-semibold ${
                                paymentMethod === 'sbp'
                                    ? 'text-blue-700 dark:text-blue-400'
                                    : 'text-gray-700 dark:text-gray-300'
                            }`}>
                                СБП
                            </span>
                        </label>
                    </div>
                </div>
            )}

            {/* Requisite Type Display */}
            <div className="relative">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    <AlertCircle className="w-4 h-4 text-blue-500" />
                    Тип реквизита
                </label>
                <div className="flex items-center gap-3 px-4 py-3.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-2 border-blue-200 dark:border-blue-700/50 rounded-xl">
                    <div className="p-2 bg-blue-500 rounded-lg">
                        {requisiteType === 'CARD' ? <CreditCard className="w-5 h-5 text-white" /> :
                         requisiteType === 'SBP' ? <Smartphone className="w-5 h-5 text-white" /> :
                         <Bitcoin className="w-5 h-5 text-white" />}
                    </div>
                    <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                        {requisiteType === 'CARD' ? 'Банковская карта' : 
                         requisiteType === 'SBP' ? 'СБП (номер телефона)' :
                         requisiteType === 'BTC' ? 'Bitcoin кошелек' :
                         requisiteType === 'LTC' ? 'Litecoin кошелек' :
                         requisiteType === 'XMR' ? 'Monero кошелек' : requisiteType}
                    </span>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">

            {/* Address/Card Number Field */}
            <div className="relative">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    {requisiteType === 'CARD' ? <CreditCard className="w-4 h-4 text-blue-500" /> :
                     requisiteType === 'SBP' ? <Smartphone className="w-4 h-4 text-blue-500" /> :
                     <Wallet className="w-4 h-4 text-blue-500" />}
                    {requisiteType === 'CARD' ? 'Номер карты' : 
                     requisiteType === 'SBP' ? 'Номер телефона' : 'Адрес кошелька'}
                </label>
                <input
                    type={requisiteType === 'SBP' ? 'tel' : 'text'}
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
                    placeholder={
                        requisiteType === 'CARD' ? '1234 5678 9012 3456' : 
                        requisiteType === 'SBP' ? '+7 (900) 123-45-67' : 
                        'Введите адрес кошелька'
                    }
                    required
                />
            </div>

            {/* Bank Details */}
            {(requisiteType === 'CARD' || requisiteType === 'SBP') && (
                <>
                    <div className="relative">
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            <Building2 className="w-4 h-4 text-blue-500" />
                            Название банка
                        </label>
                        <input
                            type="text"
                            value={formData.bank_name}
                            onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                            className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
                            placeholder="Например: Сбербанк"
                            required
                        />
                    </div>

                    <div className="relative">
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            <User className="w-4 h-4 text-blue-500" />
                            {requisiteType === 'SBP' ? 'Получатель (ФИО)' : 'Владелец карты'}
                        </label>
                        <input
                            type="text"
                            value={formData.holder_name}
                            onChange={(e) => setFormData({ ...formData, holder_name: e.target.value })}
                            className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
                            placeholder="IVANOV IVAN"
                            required
                        />
                    </div>
                </>
            )}

            {/* Comment Field - только для операций покупки */}
            {operationType === 'BUY' && (
                <div className="relative">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        <Hash className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        Комментарий <span className="text-gray-500 dark:text-gray-400 font-normal text-xs">(необязательно)</span>
                    </label>
                    <input
                        type="text"
                        value={formData.label}
                        onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                        className="block w-full px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 dark:focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500 font-medium"
                        placeholder="Например: Основная карта, Резервный кошелек"
                    />
                </div>
            )}
            </div>
            {/* <div className="flex items-center space-x-4">
                <div className="flex items-center">
                    <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-400 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded transition-colors"
                    />
                    <label className="ml-2 block text-sm text-gray-900 dark:text-gray-300">
                        Активен
                    </label>
                </div>

                <div className="flex items-center">
                    <input
                        type="checkbox"
                        checked={formData.is_default}
                        onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-400 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded transition-colors"
                    />
                    <label className="ml-2 block text-sm text-gray-900 dark:text-gray-300">
                        По умолчанию
                    </label>
                </div>
            </div> */}

            {/* Submit Button */}
            <div className="pt-4">
                <button
                    type="submit"
                    disabled={loading}
                    className="group relative w-full overflow-hidden bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                    <span className="relative flex items-center justify-center gap-2">
                        <Plus className="w-5 h-5" />
                        {loading ? 'Добавление...' : 'Добавить реквизит'}
                    </span>
                </button>
            </div>
        </form>
    );
};

export default BotRequisiteForm;
