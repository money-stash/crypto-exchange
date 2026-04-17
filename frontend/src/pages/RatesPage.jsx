import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { botsApi, ratesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-toastify';
import { Coins, RefreshCw, Save, Plus, Trash2 } from 'lucide-react';
import PageTransition from '../components/PageTransition';

const COINS = ['BTC', 'LTC', 'XMR', 'USDT'];
const COIN_BADGE_CLASSES = {
  BTC: 'from-amber-400 to-yellow-500',
  LTC: 'from-slate-400 to-gray-500',
  XMR: 'from-gray-600 to-gray-800',
  USDT: 'from-blue-500 to-indigo-600'
};

const mapRateSettings = (rows) => {
  const result = {};
  COINS.forEach((coin) => {
    const row = rows.find((r) => r.coin === coin) || {};
    result[coin] = {
      is_manual: Boolean(row.is_manual),
      manual_rate_rub: row.manual_rate_rub ?? row.rate_rub ?? ''
    };
  });
  return result;
};

const extractBots = (responseData) => {
  const payload = responseData?.data || responseData;
  if (Array.isArray(payload?.bots)) return payload.bots;
  if (Array.isArray(payload)) return payload;
  return [];
};

const groupFeeTiersByCoin = (tiers = []) => {
  return tiers.reduce((acc, tier) => {
    if (!acc[tier.coin]) {
      acc[tier.coin] = [];
    }
    acc[tier.coin].push(tier);
    return acc;
  }, {});
};

const upsertBotFee = (fees, coin, field, value) => {
  const existingIndex = fees.findIndex((fee) => fee.coin === coin);
  if (existingIndex >= 0) {
    const updated = [...fees];
    updated[existingIndex] = { ...updated[existingIndex], [field]: value };
    return updated;
  }

  return [
    ...fees,
    {
      coin,
      buy_fee: field === 'buy_fee' ? value : 0,
      sell_fee: field === 'sell_fee' ? value : 0
    }
  ];
};

const cloneTiersByCoin = (tiersByCoin = {}) => {
  const next = {};
  COINS.forEach((coin) => {
    next[coin] = (tiersByCoin[coin] || []).map((tier) => ({ ...tier }));
  });
  return next;
};

const parseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
};

const formatCoinAmount = (value) => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return Number(value).toFixed(8).replace(/\.?0+$/, '');
};

const formatPercentPreview = (value) => {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(2)).toString().replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
};

const formatRubPreview = (value) => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString('ru-RU', {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2
  });
};

const buildTierFeePreview = (tiers = [], index, feeField) => {
  const tier = tiers[index];
  if (!tier) return null;

  const minAmount = parseNumber(tier.min_amount);
  const maxAmount = parseNumber(tier.max_amount);
  if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || maxAmount <= minAmount) {
    return null;
  }

  const feeFrom = Number(tier?.[feeField] || 0);
  if (!Number.isFinite(feeFrom)) return null;

  const explicitFeeToRaw = tier?.[`${feeField}_to`];
  const hasExplicitFeeTo = explicitFeeToRaw !== undefined && explicitFeeToRaw !== null && explicitFeeToRaw !== '';
  const nextTier = tiers[index + 1];
  const feeTo = hasExplicitFeeTo
    ? Number(explicitFeeToRaw)
    : Number(nextTier?.[feeField] ?? feeFrom);

  if (!Number.isFinite(feeTo)) return null;

  const midAmount = (minAmount + maxAmount) / 2;
  const progress = (midAmount - minAmount) / (maxAmount - minAmount);
  const midFee = feeFrom + ((feeTo - feeFrom) * progress);

  return {
    minAmount,
    midAmount,
    maxAmount,
    fromPercent: feeFrom * 100,
    midPercent: midFee * 100,
    toPercent: feeTo * 100
  };
};

const buildTierBuyCoinPreview = (tiers = [], index, rateRub) => {
  const feePreview = buildTierFeePreview(tiers, index, 'buy_fee');
  if (!feePreview || !Number.isFinite(rateRub) || rateRub <= 0) return null;

  const startDenominator = rateRub * (1 + (feePreview.fromPercent / 100));
  const midDenominator = rateRub * (1 + (feePreview.midPercent / 100));
  const endDenominator = rateRub * (1 + (feePreview.toPercent / 100));

  const startCoin = Number.isFinite(startDenominator) && startDenominator > 0
    ? feePreview.minAmount / startDenominator
    : null;
  const midCoin = Number.isFinite(midDenominator) && midDenominator > 0
    ? feePreview.midAmount / midDenominator
    : null;
  const endCoin = Number.isFinite(endDenominator) && endDenominator > 0
    ? feePreview.maxAmount / endDenominator
    : null;

  if (
    !Number.isFinite(startCoin) || startCoin <= 0 ||
    !Number.isFinite(midCoin) || midCoin <= 0 ||
    !Number.isFinite(endCoin) || endCoin <= 0
  ) {
    return null;
  }

  return {
    startCoin,
    midCoin,
    endCoin
  };
};

const buildTierBuyRatePreview = (tiers = [], index, rateRub) => {
  const feePreview = buildTierFeePreview(tiers, index, 'buy_fee');
  if (!feePreview || !Number.isFinite(rateRub) || rateRub <= 0) return null;

  const startRate = rateRub * (1 + (feePreview.fromPercent / 100));
  const midRate = rateRub * (1 + (feePreview.midPercent / 100));
  const endRate = rateRub * (1 + (feePreview.toPercent / 100));

  if (!Number.isFinite(startRate) || !Number.isFinite(midRate) || !Number.isFinite(endRate)) {
    return null;
  }

  return { startRate, midRate, endRate };
};

const validateTiersClientSide = (tiers = []) => {
  const errors = [];

  if (tiers.length === 0) {
    return { valid: true, errors: [] };
  }

  const normalizedTiers = tiers.map((tier) => ({
    ...tier,
    min_amount: typeof tier.min_amount === 'number' ? tier.min_amount : parseFloat(tier.min_amount) || 0,
    max_amount: tier.max_amount === null || tier.max_amount === undefined || tier.max_amount === ''
      ? null
      : (typeof tier.max_amount === 'number' ? tier.max_amount : parseFloat(tier.max_amount)),
    buy_fee: typeof tier.buy_fee === 'number' ? tier.buy_fee : parseFloat(tier.buy_fee) || 0,
    sell_fee: typeof tier.sell_fee === 'number' ? tier.sell_fee : parseFloat(tier.sell_fee) || 0
  }));

  const sortedTiers = [...normalizedTiers].sort((a, b) => a.min_amount - b.min_amount);

  for (let i = 0; i < sortedTiers.length; i += 1) {
    const tier = sortedTiers[i];
    const nextTier = sortedTiers[i + 1];

    if (isNaN(tier.min_amount) || tier.min_amount < 0) {
      errors.push(`Диапазон ${i + 1}: минимальная сумма должна быть неотрицательной`);
      continue;
    }

    if (tier.max_amount !== null && (isNaN(tier.max_amount) || tier.max_amount <= tier.min_amount)) {
      errors.push(`Диапазон ${i + 1}: максимальная сумма должна быть больше минимальной`);
      continue;
    }

    if (nextTier && sortedTiers.length > 1) {
      if (tier.max_amount === null) {
        errors.push(`Диапазон ${i + 1}: безлимитный диапазон должен быть последним`);
      } else if (Math.abs(tier.max_amount - nextTier.min_amount) > 0.001) {
        if (tier.max_amount < nextTier.min_amount) {
          errors.push(`Пробел между диапазоном ${i + 1} и ${i + 2}: ${tier.max_amount.toFixed(2)} до ${nextTier.min_amount.toFixed(2)}`);
        } else {
          errors.push(`Пересечение между диапазонами ${i + 1} и ${i + 2}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

const RatesPage = () => {
  const { isAdmin, isExAdmin } = useAuth();

  const [rates, setRates] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRateCoin, setSavingRateCoin] = useState(null);

  const [bots, setBots] = useState([]);
  const [loadingBots, setLoadingBots] = useState(false);
  const [loadingBotFees, setLoadingBotFees] = useState(false);
  const [feeTiersByBot, setFeeTiersByBot] = useState({});
  const [botFeesByBot, setBotFeesByBot] = useState({});
  const [botEditingValues, setBotEditingValues] = useState({});
  const [savingBotFeesId, setSavingBotFeesId] = useState(null);

  const [selectedBotId, setSelectedBotId] = useState('');
  const [inlineTiersByCoin, setInlineTiersByCoin] = useState({});
  const [savingTierCoin, setSavingTierCoin] = useState('');
  const [tierValidationErrorsByCoin, setTierValidationErrorsByCoin] = useState({});
  const [tierValidationCheckedByCoin, setTierValidationCheckedByCoin] = useState({});
  const [activeTierCoin, setActiveTierCoin] = useState('');
  const [tierInfoOpenMap, setTierInfoOpenMap] = useState({});

  const canManageBotFees = isAdmin || isExAdmin;

  const selectedBot = useMemo(() => {
    if (!selectedBotId) return null;
    return bots.find((bot) => String(bot.id) === String(selectedBotId)) || null;
  }, [bots, selectedBotId]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      if (isAdmin) {
        const response = await ratesApi.getSettings();
        const rows = response.data || [];
        setRates(rows);
        setSettings(mapRateSettings(rows));
      } else {
        const response = await ratesApi.getRates();
        setRates(response.data || []);
      }

      if (canManageBotFees) {
        setLoadingBots(true);
        setLoadingBotFees(true);

        const botsResponse = await botsApi.getBots({ page: 1, limit: 100 });
        const botsList = extractBots(botsResponse.data);
        setBots(botsList);

        if (botsList.length > 0) {
          const botData = await Promise.all(
            botsList.map(async (bot) => {
              try {
                const [feesResponse, tiersResponse] = await Promise.all([
                  botsApi.getBotFees(bot.id).catch((error) => {
                    console.error(`Failed to load fees for bot ${bot.id}:`, error);
                    return { data: [] };
                  }),
                  botsApi.getBotFeeTiers(bot.id).catch((error) => {
                    console.error(`Failed to load fee tiers for bot ${bot.id}:`, error);
                    return { data: [] };
                  })
                ]);

                return {
                  botId: bot.id,
                  fees: Array.isArray(feesResponse.data) ? feesResponse.data : [],
                  tiers: groupFeeTiersByCoin(Array.isArray(tiersResponse.data) ? tiersResponse.data : [])
                };
              } catch (error) {
                console.error(`Failed to load bot fee config for bot ${bot.id}:`, error);
                return { botId: bot.id, fees: [], tiers: {} };
              }
            })
          );

          const feesMap = Object.fromEntries(botData.map((item) => [item.botId, item.fees]));
          const tiersMap = Object.fromEntries(botData.map((item) => [item.botId, item.tiers]));

          setBotFeesByBot(feesMap);
          setFeeTiersByBot(tiersMap);
        } else {
          setBotFeesByBot({});
          setFeeTiersByBot({});
        }
      } else {
        setBots([]);
        setBotFeesByBot({});
        setFeeTiersByBot({});
      }
    } catch (error) {
      console.error('Failed to load rates:', error);
      toast.error('Failed to load rates');
    } finally {
      setLoading(false);
      if (canManageBotFees) {
        setLoadingBots(false);
        setLoadingBotFees(false);
      }
    }
  }, [isAdmin, canManageBotFees]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!bots.length) {
      setSelectedBotId('');
      return;
    }

    const exists = bots.some((bot) => String(bot.id) === String(selectedBotId));
    if (!exists) {
      setSelectedBotId(String(bots[0].id));
    }
  }, [bots, selectedBotId]);

  useEffect(() => {
    if (!selectedBot) {
      setInlineTiersByCoin({});
      setTierValidationErrorsByCoin({});
      setTierValidationCheckedByCoin({});
      setActiveTierCoin('');
      return;
    }

    const source = feeTiersByBot[selectedBot.id] || {};
    setInlineTiersByCoin(cloneTiersByCoin(source));
    setTierValidationErrorsByCoin({});
    setTierValidationCheckedByCoin({});
    setActiveTierCoin('');
  }, [selectedBot, feeTiersByBot]);

  const refreshSelectedBotTiers = async (botId) => {
    const response = await botsApi.getBotFeeTiers(botId);
    const grouped = groupFeeTiersByCoin(Array.isArray(response.data) ? response.data : []);
    setFeeTiersByBot((prev) => ({
      ...prev,
      [botId]: grouped
    }));
    return grouped;
  };

  const handleRefreshRates = async () => {
    try {
      setRefreshing(true);
      await ratesApi.refreshRates();
      await fetchData();
      toast.success('Rates updated');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to refresh rates');
    } finally {
      setRefreshing(false);
    }
  };

  const updateCoinSetting = (coin, updater) => {
    setSettings((prev) => ({
      ...prev,
      [coin]: updater(prev[coin] || {
        is_manual: false,
        manual_rate_rub: ''
      })
    }));
  };

  const saveManualRate = async (coin) => {
    const coinSettings = settings[coin];
    if (!coinSettings) return;

    try {
      setSavingRateCoin(coin);

      if (coinSettings.is_manual) {
        const manualRate = Number(coinSettings.manual_rate_rub);
        if (!Number.isFinite(manualRate) || manualRate <= 0) {
          toast.error(`${coin}: enter a valid rate`);
          return;
        }
        await ratesApi.updateManualRate(coin, { rate_rub: manualRate });
      } else {
        await ratesApi.disableManualRate(coin);
      }

      await fetchData();
      toast.success(`${coin}: rate saved`);
    } catch (error) {
      toast.error(error.response?.data?.error || `${coin}: failed to save rate`);
    } finally {
      setSavingRateCoin(null);
    }
  };

  const handleBotFeeChange = (botId, coin, field, rawValue) => {
    const key = `${botId}_${coin}_${field}`;
    setBotEditingValues((prev) => ({
      ...prev,
      [key]: rawValue
    }));

    const normalizedValue = String(rawValue).replace(',', '.');
    if (normalizedValue === '' || normalizedValue === '-') {
      setBotFeesByBot((prev) => ({
        ...prev,
        [botId]: upsertBotFee(prev[botId] || [], coin, field, 0)
      }));
      return;
    }

    const numValue = parseFloat(normalizedValue);
    if (Number.isNaN(numValue)) return;

    const decimalValue = numValue / 100;
    setBotFeesByBot((prev) => ({
      ...prev,
      [botId]: upsertBotFee(prev[botId] || [], coin, field, decimalValue)
    }));
  };

  const getBotFeeFieldValue = (botId, coin, field) => {
    const key = `${botId}_${coin}_${field}`;
    if (Object.prototype.hasOwnProperty.call(botEditingValues, key)) {
      return botEditingValues[key];
    }

    const fee = (botFeesByBot[botId] || []).find((item) => item.coin === coin);
    return ((Number(fee?.[field] || 0)) * 100).toFixed(2);
  };

  const handleBotFeeFieldBlur = (botId, coin, field) => {
    const key = `${botId}_${coin}_${field}`;
    setBotEditingValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSaveBotFees = async (botId) => {
    try {
      setSavingBotFeesId(botId);

      const currentFees = botFeesByBot[botId] || [];
      const payload = COINS.map((coin) => {
        const fee = currentFees.find((item) => item.coin === coin);
        return {
          coin,
          buy_fee: Number(fee?.buy_fee || 0),
          sell_fee: Number(fee?.sell_fee || 0)
        };
      });

      await botsApi.updateBotFees(botId, { fees: payload });

      const refreshed = await botsApi.getBotFees(botId);
      setBotFeesByBot((prev) => ({
        ...prev,
        [botId]: Array.isArray(refreshed.data) ? refreshed.data : []
      }));

      setBotEditingValues((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (key.startsWith(`${botId}_`)) {
            delete next[key];
          }
        });
        return next;
      });

      toast.success(`Bot #${botId}: fees saved`);
    } catch (error) {
      toast.error(error.response?.data?.error || `Bot #${botId}: failed to save fees`);
    } finally {
      setSavingBotFeesId(null);
    }
  };

  const handleTierFieldChange = (coin, index, field, rawValue) => {
    setInlineTiersByCoin((prev) => {
      const next = { ...prev };
      const tiers = [...(next[coin] || [])];
      const tier = { ...(tiers[index] || {}) };

      if (field === 'min_amount') {
        const parsed = parseNumber(rawValue);
        tier.min_amount = parsed === null ? 0 : parsed;
      }

      if (field === 'max_amount') {
        const parsed = parseNumber(rawValue);
        tier.max_amount = parsed;
      }

      if (field === 'buy_fee' || field === 'sell_fee') {
        const parsed = parseNumber(rawValue);
        tier[field] = parsed === null ? 0 : parsed / 100;
      }

      tiers[index] = tier;
      next[coin] = tiers;
      return next;
    });

    setTierValidationErrorsByCoin((prev) => ({
      ...prev,
      [coin]: []
    }));
    setTierValidationCheckedByCoin((prev) => ({
      ...prev,
      [coin]: false
    }));
  };

  const handleAddTier = (coin) => {
    setInlineTiersByCoin((prev) => {
      const next = { ...prev };
      const tiers = [...(next[coin] || [])];
      const last = tiers[tiers.length - 1];
      const minAmount = last ? Number(last.max_amount ?? last.min_amount ?? 0) : 0;

      tiers.push({
        coin,
        min_amount: Number.isFinite(minAmount) ? minAmount : 0,
        max_amount: null,
        buy_fee: 0,
        sell_fee: 0
      });

      next[coin] = tiers;
      return next;
    });

    setTierValidationErrorsByCoin((prev) => ({
      ...prev,
      [coin]: []
    }));
    setTierValidationCheckedByCoin((prev) => ({
      ...prev,
      [coin]: false
    }));
  };

  const handleDeleteTier = (coin, index) => {
    setInlineTiersByCoin((prev) => {
      const next = { ...prev };
      next[coin] = (next[coin] || []).filter((_, i) => i !== index);
      return next;
    });

    setTierValidationErrorsByCoin((prev) => ({
      ...prev,
      [coin]: []
    }));
    setTierValidationCheckedByCoin((prev) => ({
      ...prev,
      [coin]: false
    }));
  };

  const handleSaveCoinTiers = async (coin) => {
    if (!selectedBot) return;

    try {
      setSavingTierCoin(coin);
      const currentTiers = inlineTiersByCoin[coin] || [];
      const validationResult = validateTiersClientSide(currentTiers);
      if (!validationResult.valid) {
        setTierValidationErrorsByCoin((prev) => ({
          ...prev,
          [coin]: validationResult.errors
        }));
        setTierValidationCheckedByCoin((prev) => ({
          ...prev,
          [coin]: true
        }));
        toast.error(`${coin}: исправьте ошибки диапазонов перед сохранением`);
        return;
      }

      const tiers = currentTiers.map((tier) => ({
        ...(tier.id ? { id: tier.id, bot_id: tier.bot_id } : {}),
        coin,
        min_amount: Number(tier.min_amount || 0),
        max_amount: tier.max_amount === null || tier.max_amount === '' ? null : Number(tier.max_amount),
        buy_fee: Number(tier.buy_fee || 0),
        sell_fee: Number(tier.sell_fee || 0)
      }));

      await botsApi.bulkUpdateFeeTiers(selectedBot.id, {
        coin,
        tiers
      });

      const grouped = await refreshSelectedBotTiers(selectedBot.id);
      setInlineTiersByCoin(cloneTiersByCoin(grouped));
      setTierValidationErrorsByCoin((prev) => ({
        ...prev,
        [coin]: []
      }));
      setTierValidationCheckedByCoin((prev) => ({
        ...prev,
        [coin]: true
      }));
      toast.success(`${coin}: диапазоны сохранены`);
    } catch (error) {
      toast.error(error.response?.data?.error || `${coin}: не удалось сохранить диапазоны`);
    } finally {
      setSavingTierCoin('');
    }
  };

  const handleOpenCoinTiers = (coin) => {
    if (!selectedBot) {
      toast.info('Select bot first');
      return;
    }

    setActiveTierCoin((prev) => (prev === coin ? '' : coin));
    setTierValidationErrorsByCoin((prev) => ({
      ...prev,
      [coin]: []
    }));
    setTierValidationCheckedByCoin((prev) => ({
      ...prev,
      [coin]: false
    }));
  };

  return (
    <PageTransition>
      <div className="space-y-2">
        <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200/60 dark:border-gray-700/60 shadow">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{"\u041a\u0443\u0440\u0441\u044b"}</h1>
          </div>
          {isAdmin && (
            <button
              onClick={handleRefreshRates}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? "\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435..." : "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c"}
            </button>
          )}
        </div>

        <div
          className="w-full rounded-2xl border border-gray-200/60 dark:border-gray-700/60 bg-white/90 dark:bg-gray-900/90 overflow-hidden"
          style={{ maxWidth: 700 }}
        >
          {canManageBotFees && (
            <div className="px-3 py-2 border-b border-gray-200/70 dark:border-gray-700/70 flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">{"\u041a\u043e\u043c\u0438\u0441\u0441\u0438\u0438:"}</span>
              <select
                value={selectedBotId}
                onChange={(e) => setSelectedBotId(e.target.value)}
                className="flex-1 max-w-xs h-7 px-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-200"
                disabled={loadingBots || loadingBotFees || bots.length === 0}
              >
                {bots.length === 0 && <option value="">{"\u0411\u043e\u0442\u044b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b"}</option>}
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name || bot.identifier || `\u0411\u043e\u0442 #${bot.id}`}
                  </option>
                ))}
              </select>
              {selectedBot && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  Number(selectedBot.is_active) === 1
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}>
                  {Number(selectedBot.is_active) === 1 ? "\u0410\u043a\u0442\u0438\u0432\u0435\u043d" : "\u041d\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442"}
                </span>
              )}
            </div>
          )}
          <div className="w-full">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-1.5">{"\u0412\u0430\u043b\u044e\u0442\u0430"}</th>
                  <th className="px-3 py-1.5">{"\u041a\u0443\u0440\u0441"}</th>
                  {isAdmin && <th className="px-3 py-1.5">{"\u0420\u0443\u0447\u043d\u043e\u0439 \u043a\u0443\u0440\u0441"}</th>}
                  <th className="px-3 py-1.5">{isAdmin ? "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c" : "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f"}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => {
                  const coinSettings = settings[rate.coin] || {
                    is_manual: Number(rate.is_manual) === 1,
                    manual_rate_rub: rate.manual_rate_rub ?? rate.rate_rub ?? ''
                  };
                  const isActiveCoinRow = canManageBotFees && selectedBot && activeTierCoin === rate.coin;
                  const coinTiers = inlineTiersByCoin[rate.coin] || [];
                  const sortedCoinTiers = [...coinTiers].sort((a, b) => Number(a.min_amount) - Number(b.min_amount));
                  const firstCoinTier = sortedCoinTiers[0] || null;
                  const lastCoinTier = sortedCoinTiers[sortedCoinTiers.length - 1] || null;
                  const minOrderRub = firstCoinTier ? Number(firstCoinTier.min_amount) : null;
                  const maxOrderRub = lastCoinTier && lastCoinTier.max_amount !== null && lastCoinTier.max_amount !== undefined && lastCoinTier.max_amount !== ''
                    ? Number(lastCoinTier.max_amount)
                    : null;
                  const rateRub = Number(
                    coinSettings.is_manual
                      ? (coinSettings.manual_rate_rub ?? rate.rate_rub ?? 0)
                      : (rate.rate_rub ?? 0)
                  );
                  const minBuyFee = firstCoinTier ? Number(firstCoinTier.buy_fee || 0) : null;
                  const minSellFee = firstCoinTier ? Number(firstCoinTier.sell_fee || 0) : null;
                  const maxBuyFee = lastCoinTier ? Number(lastCoinTier.buy_fee || 0) : null;
                  const maxSellFee = lastCoinTier ? Number(lastCoinTier.sell_fee || 0) : null;
                  const minOrderCoinBuy = Number.isFinite(minOrderRub) && rateRub > 0 && Number.isFinite(minBuyFee) && (1 + minBuyFee) > 0
                    ? minOrderRub / (rateRub * (1 + minBuyFee))
                    : null;
                  const minOrderCoinSell = Number.isFinite(minOrderRub) && rateRub > 0 && Number.isFinite(minSellFee) && (1 + minSellFee) > 0
                    ? minOrderRub / (rateRub * (1 + minSellFee))
                    : null;
                  const maxOrderCoinBuy = Number.isFinite(maxOrderRub) && rateRub > 0 && Number.isFinite(maxBuyFee) && (1 + maxBuyFee) > 0
                    ? maxOrderRub / (rateRub * (1 + maxBuyFee))
                    : null;
                  const maxOrderCoinSell = Number.isFinite(maxOrderRub) && rateRub > 0 && Number.isFinite(maxSellFee) && (1 + maxSellFee) > 0
                    ? maxOrderRub / (rateRub * (1 + maxSellFee))
                    : null;
                  const coinValidationErrors = tierValidationErrorsByCoin[rate.coin] || [];
                  const coinValidationChecked = Boolean(tierValidationCheckedByCoin[rate.coin]);
                  const columnsCount = isAdmin ? 4 : 3;

                  return (
                    <React.Fragment key={rate.coin}>
                      <tr className="border-t border-gray-200/70 dark:border-gray-700/70">
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${COIN_BADGE_CLASSES[rate.coin] || 'from-slate-400 to-slate-600'} text-white text-xs font-bold flex items-center justify-center`}>
                              {rate.coin.slice(0, 1)}
                            </div>
                            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{rate.coin}</div>
                          </div>
                        </td>

                        <td className="px-3 py-1.5">
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {Number(rate.rate_rub || 0).toLocaleString('ru-RU')} {"\u20bd"}
                          </div>
                        </td>

                        {isAdmin && (
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={Boolean(coinSettings.is_manual)}
                                onChange={(e) => updateCoinSetting(rate.coin, (current) => ({
                                  ...current,
                                  is_manual: e.target.checked,
                                  manual_rate_rub: current.manual_rate_rub ?? rate.rate_rub ?? ''
                                }))}
                                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                title={"\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0440\u0443\u0447\u043d\u043e\u0439 \u043a\u0443\u0440\u0441"}
                              />
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={coinSettings.manual_rate_rub}
                                onChange={(e) => updateCoinSetting(rate.coin, (current) => ({
                                  ...current,
                                  manual_rate_rub: e.target.value
                                }))}
                                disabled={!coinSettings.is_manual}
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-200 text-sm disabled:opacity-60"
                                placeholder={"\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u0443\u0440\u0441"}
                              />
                            </div>
                          </td>
                        )}

                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            {isAdmin && (
                              <button
                                onClick={() => saveManualRate(rate.coin)}
                                disabled={savingRateCoin === rate.coin}
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white disabled:opacity-60"
                                title={`\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c ${rate.coin}`}
                              >
                                <Save className="w-4 h-4" />
                              </button>
                            )}
                            {canManageBotFees && (
                              <button
                                onClick={() => handleOpenCoinTiers(rate.coin)}
                                className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border ${
                                  activeTierCoin === rate.coin
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-blue-600 border-blue-600 text-white'
                                }`}
                                title={activeTierCoin === rate.coin
                                  ? `\u0421\u043a\u0440\u044b\u0442\u044c \u0434\u0438\u0430\u043f\u0430\u0437\u043e\u043d\u044b ${rate.coin}`
                                  : `\u0414\u0438\u0430\u043f\u0430\u0437\u043e\u043d\u044b ${rate.coin}`}
                              >
                                <Plus
                                  className="w-4 h-4"
                                  style={{
                                    transform: activeTierCoin === rate.coin ? 'rotate(45deg)' : 'rotate(0deg)',
                                    transition: 'transform 200ms ease'
                                  }}
                                />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isActiveCoinRow && (
                        <tr className="border-t border-gray-200/70 dark:border-gray-700/70">
                          <td colSpan={columnsCount} className="px-3 py-3 bg-gray-50/40 dark:bg-gray-900/40">
                            <div className="rounded-2xl bg-white/80 dark:bg-gray-900/80 space-y-4">
                              {coinTiers.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white/70 dark:bg-gray-800/50 px-3 py-2">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Минимальная сумма заказа</p>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                      {Number.isFinite(minOrderRub) && Number.isFinite(minOrderCoinBuy) && Number.isFinite(minOrderCoinSell)
                                        ? `${minOrderRub.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}₽ (покупка: ${formatCoinAmount(minOrderCoinBuy)} ${rate.coin}, продажа: ${formatCoinAmount(minOrderCoinSell)} ${rate.coin})`
                                        : '—'}
                                    </p>
                                  </div>
                                  <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white/70 dark:bg-gray-800/50 px-3 py-2">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Максимальная сумма заказа</p>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                      {Number.isFinite(maxOrderRub) && Number.isFinite(maxOrderCoinBuy) && Number.isFinite(maxOrderCoinSell)
                                        ? `${maxOrderRub.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}₽ (покупка: ${formatCoinAmount(maxOrderCoinBuy)} ${rate.coin}, продажа: ${formatCoinAmount(maxOrderCoinSell)} ${rate.coin})`
                                        : 'Без ограничений'}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {coinValidationChecked && coinValidationErrors.length > 0 && (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 rounded-xl p-4">
                                  <h3 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                                    {"\u041e\u0448\u0438\u0431\u043a\u0438 \u0432\u0430\u043b\u0438\u0434\u0430\u0446\u0438\u0438"}
                                  </h3>
                                  <ul className="text-sm text-red-700 dark:text-red-400 space-y-1">
                                    {coinValidationErrors.map((error, errorIndex) => (
                                      <li key={`${rate.coin}-validation-${errorIndex}`}>{"\u2022"} {error}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {coinValidationChecked && coinTiers.length > 0 && coinValidationErrors.length === 0 && (
                                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/30 rounded-xl p-4">
                                  <p className="text-sm text-green-700 dark:text-green-400">
                                    {"\u2713 \u0414\u0438\u0430\u043f\u0430\u0437\u043e\u043d\u044b \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u044b \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e"}
                                  </p>
                                </div>
                              )}

                              <div className="space-y-4">
                                {coinTiers.map((tier, index) => {
                                  const buyPreview = buildTierFeePreview(coinTiers, index, 'buy_fee');
                                  const buyCoinPreview = buildTierBuyCoinPreview(coinTiers, index, rateRub);
                                  const buyRatePreview = buildTierBuyRatePreview(coinTiers, index, rateRub);
                                  const tierInfoKey = `${rate.coin}-${tier.id || index}`;
                                  const hasTierInfo = Boolean(buyPreview || buyCoinPreview || buyRatePreview);
                                  const isTierInfoOpen = Boolean(tierInfoOpenMap[tierInfoKey]);

                                  return (
                                    <div key={tier.id || `${rate.coin}-${index}`} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-gray-200 dark:border-gray-600">
                                      <div
                                        className="grid gap-4 items-end"
                                        style={{
                                          gridTemplateColumns: 'max-content minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) max-content',
                                          width: '100%'
                                        }}
                                      >
                                        <div style={{ width: 'max-content', alignSelf: 'center' }}>
                                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">&nbsp;</label>
                                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                            {index + 1}
                                          </h4>
                                        </div>

                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                            {"\u041e\u0442 \u0441\u0443\u043c\u043c\u044b (\u20bd)"}
                                          </label>
                                          <input
                                            type="text"
                                            placeholder="0"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            value={tier.min_amount ?? ''}
                                            onChange={(e) => handleTierFieldChange(rate.coin, index, 'min_amount', e.target.value)}
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                            {"\u0414\u043e \u0441\u0443\u043c\u043c\u044b (\u20bd)"}
                                          </label>
                                          <input
                                            type="text"
                                            placeholder={"\u0411\u0435\u0437 \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u0438\u0439"}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            value={tier.max_amount !== null && tier.max_amount !== undefined ? tier.max_amount : ''}
                                            onChange={(e) => handleTierFieldChange(rate.coin, index, 'max_amount', e.target.value)}
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                            {"\u041a\u043e\u043c\u0438\u0441\u0441\u0438\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0438 (%)"}
                                          </label>
                                          <input
                                            type="text"
                                            placeholder="0"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            value={Number(tier.buy_fee || 0) * 100}
                                            onChange={(e) => handleTierFieldChange(rate.coin, index, 'buy_fee', e.target.value)}
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                            {"\u041a\u043e\u043c\u0438\u0441\u0441\u0438\u044f \u043f\u0440\u043e\u0434\u0430\u0436\u0438 (%)"}
                                          </label>
                                          <input
                                            type="text"
                                            placeholder="0"
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-200"
                                            value={Number(tier.sell_fee || 0) * 100}
                                            onChange={(e) => handleTierFieldChange(rate.coin, index, 'sell_fee', e.target.value)}
                                          />
                                        </div>

                                        <div style={{ width: 'max-content', alignSelf: 'center' }}>
                                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">&nbsp;</label>
                                          <button
                                            onClick={() => handleDeleteTier(rate.coin, index)}
                                            className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0434\u0438\u0430\u043f\u0430\u0437\u043e\u043d"}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </div>
                                      </div>

                                      {hasTierInfo && (
                                        <div className="mt-2">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setTierInfoOpenMap((prev) => ({
                                                ...prev,
                                                [tierInfoKey]: !prev[tierInfoKey]
                                              }));
                                            }}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2"
                                          >
                                            {isTierInfoOpen ? 'Скрыть инфо' : 'Инфо'}
                                          </button>
                                        </div>
                                      )}

                                      {hasTierInfo && isTierInfoOpen && (
                                        <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-800/40 bg-blue-50/70 dark:bg-blue-900/10 px-3 py-2 space-y-1">
                                          {buyPreview && (
                                            <p className="text-xs text-gray-600 dark:text-gray-300">
                                              <span className="font-medium text-gray-700 dark:text-gray-200">Покупка (примерно): </span>
                                              {`${formatRubPreview(buyPreview.minAmount)} (${formatPercentPreview(buyPreview.fromPercent)}%)`}
                                              {' > '}
                                              {`${formatRubPreview(buyPreview.midAmount)} (${formatPercentPreview(buyPreview.midPercent)}%)`}
                                              {' > '}
                                              {`${formatRubPreview(buyPreview.maxAmount)} (${formatPercentPreview(buyPreview.toPercent)}%)`}
                                            </p>
                                          )}
                                          {buyCoinPreview && (
                                            <p className="text-xs text-gray-600 dark:text-gray-300">
                                              <span className="font-medium text-gray-700 dark:text-gray-200">Диапазон BTC (покупка): </span>
                                              {`${formatCoinAmount(buyCoinPreview.startCoin)} ${rate.coin}`}
                                              {' > '}
                                              {`${formatCoinAmount(buyCoinPreview.midCoin)} ${rate.coin}`}
                                              {' > '}
                                              {`${formatCoinAmount(buyCoinPreview.endCoin)} ${rate.coin}`}
                                            </p>
                                          )}
                                          {buyRatePreview && (
                                            <p className="text-xs text-gray-600 dark:text-gray-300">
                                              <span className="font-medium text-gray-700 dark:text-gray-200">Курс BTC в диапазоне: </span>
                                              {`${formatRubPreview(buyRatePreview.startRate)} ₽`}
                                              {' > '}
                                              {`${formatRubPreview(buyRatePreview.midRate)} ₽`}
                                              {' > '}
                                              {`${formatRubPreview(buyRatePreview.endRate)} ₽`}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                <button
                                  onClick={() => handleAddTier(rate.coin)}
                                  className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-gray-500 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Plus className="w-5 h-5" />
                                  {"\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0434\u0438\u0430\u043f\u0430\u0437\u043e\u043d"}
                                </button>

                                <div className="flex flex-col sm:flex-row gap-3">
                                  {coinTiers.length > 0 && (
                                    <button
                                      onClick={() => {
                                        const validationResult = validateTiersClientSide(coinTiers);
                                        setTierValidationErrorsByCoin((prev) => ({
                                          ...prev,
                                          [rate.coin]: validationResult.errors
                                        }));
                                        setTierValidationCheckedByCoin((prev) => ({
                                          ...prev,
                                          [rate.coin]: true
                                        }));
                                      }}
                                      className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl p-3 text-sm font-medium transition-colors"
                                    >
                                      {"\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u043e\u0441\u0442\u044c \u0434\u0438\u0430\u043f\u0430\u0437\u043e\u043d\u043e\u0432"}
                                    </button>
                                  )}

                                  <button
                                    onClick={() => handleSaveCoinTiers(rate.coin)}
                                    disabled={savingTierCoin === rate.coin}
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-sm font-semibold disabled:opacity-60"
                                  >
                                    <Save className="w-4 h-4" />
                                    {savingTierCoin === rate.coin ? "\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435..." : `\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u0434\u0438\u0430\u043f\u0430\u0437\u043e\u043d\u044b ${rate.coin}`}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && rates.length === 0 && (
            <div className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{"\u041a\u0443\u0440\u0441\u044b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b"}</div>
          )}
        </div>

      </div>
    </PageTransition>
  );
};

export default RatesPage;

