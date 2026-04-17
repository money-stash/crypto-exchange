const User = require('../models/User');
const Bot = require('../models/Bot');
const { getConnection } = require('../config/database');

class UserController {
    // получение всех пользователей
    async getUsers(req, res) {
        try {
            const db = getConnection();
            const {
                search = '',
                status = 'all',
                sortBy = 'created_at',
                sortOrder = 'desc',
                page = 1,
                limit = 20
            } = req.query;

            // определяем bot_id в зависимости от роли пользователя
            let botId = null;
            if (req.user.role === 'EX_ADMIN') {
                const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
                if (botResult.length === 0) {
                    res.json({
                        users: [],
                        stats: {
                            total: 0,
                            active: 0,
                            premium: 0,
                            blocked: 0,
                            todayRegistrations: 0,
                            totalVolume: 0
                        },
                        total: 0,
                        pages: 0,
                        currentPage: 1,
                        error: 'Ошибка при получении пользователей'
                    });
                    return;
                }
                botId = botResult[0].id;
            }

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 20;
            const offset = (pageNum - 1) * limitNum;
            let whereClause = '1=1';
            const params = [];

            if (search) {
                whereClause += ' AND (u.tg_id LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (status === 'active') {
                whereClause += ' AND u.is_blocked = 0';
            } else if (status === 'blocked') {
                whereClause += ' AND u.is_blocked = 1';
            }

            if (botId !== null) {
                whereClause += ' AND ub.bot_id = ?';
                params.push(botId);
            }

            const sortFields = {
                'created_at': 'u.created_at',
                'total_volume': 'order_stats.total_volume',
                'orders_count': 'order_stats.orders_count'
            };
            const sortField = sortFields[sortBy] || 'u.created_at';
            const validSortOrder = ['asc', 'desc'].includes((sortOrder || '').toLowerCase()) ? sortOrder.toLowerCase() : 'desc';

            let query, queryParams;

            if (req.user.role === 'SUPERADMIN') {
                query = `
                    SELECT 
                        u.*,
                        COALESCE(order_stats.orders_count, 0) as orders_count,
                        COALESCE(order_stats.total_volume, 0) as total_volume,
                        0 as referrals_count,
                        GROUP_CONCAT(DISTINCT CONCAT(b.id, ':', b.name) SEPARATOR '|') as bot_data
                    FROM users u
                    LEFT JOIN user_bots ub ON u.id = ub.user_id
                    LEFT JOIN bots b ON ub.bot_id = b.id
                    LEFT JOIN (
                        SELECT 
                            user_id,
                            COUNT(*) as orders_count,
                            SUM(sum_rub) as total_volume
                        FROM orders
                        GROUP BY user_id
                    ) order_stats ON u.id = order_stats.user_id
                    WHERE ${whereClause}
                    GROUP BY u.id
                    ORDER BY ${sortField} ${validSortOrder.toUpperCase()}
                    LIMIT ${limitNum} OFFSET ${offset}
                `;
                queryParams = params;
            } else {

                query = `
                    SELECT 
                        u.*,
                        COALESCE(order_stats.orders_count, 0) as orders_count,
                        COALESCE(order_stats.total_volume, 0) as total_volume,
                        0 as referrals_count
                    FROM users u
                    LEFT JOIN (
                        SELECT 
                            user_id,
                            COUNT(*) as orders_count,
                            SUM(sum_rub) as total_volume
                        FROM orders
                        GROUP BY user_id
                    ) order_stats ON u.id = order_stats.user_id
                    ${botId !== null ? 'INNER JOIN user_bots ub ON u.id = ub.user_id AND ub.bot_id = ?' : ''}
                    WHERE ${whereClause}
                    GROUP BY u.id
                    ORDER BY ${sortField} ${validSortOrder.toUpperCase()}
                    LIMIT ${limitNum} OFFSET ${offset}
                `;
                queryParams = botId !== null ? [...params, botId] : params;
            }

            const [users] = await db.execute(query, queryParams);

            if (req.user.role === 'SUPERADMIN') {
                users.forEach(user => {
                    if (user.bot_data) {
                        user.user_bots = user.bot_data.split('|').map(botInfo => {
                            const [botId, botName] = botInfo.split(':');
                            return {
                                bot_id: parseInt(botId),
                                bot_name: botName
                            };
                        });
                    } else {
                        user.user_bots = [];
                    }
                    // убираем временное поле
                    delete user.bot_data;
                });
            }

            // подсчёт общего количества пользователей
            let countQuery, countParams = [];
            let countWhereClause = '1=1';

            if (search) {
                countWhereClause += ' AND (u.tg_id LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)';
                countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            if (status === 'active') {
                countWhereClause += ' AND u.is_blocked = 0';
            } else if (status === 'blocked') {
                countWhereClause += ' AND u.is_blocked = 1';
            }

            if (req.user.role === 'SUPERADMIN') {
                countQuery = `
                    SELECT COUNT(DISTINCT u.id) as total
                    FROM users u
                    LEFT JOIN user_bots ub ON u.id = ub.user_id
                    LEFT JOIN bots b ON ub.bot_id = b.id
                    WHERE ${countWhereClause}
                `;
            } else {

                if (botId !== null) {
                    countWhereClause += ' AND ub.bot_id = ?';
                    countParams.push(botId);
                }
                countQuery = `
                    SELECT COUNT(DISTINCT u.id) as total
                    FROM users u
                    LEFT JOIN user_bots ub ON u.id = ub.user_id
                    WHERE ${countWhereClause}
                `;
            }

            const [countResult] = await db.execute(countQuery, countParams);
            const total = countResult[0]?.total || 0;

            // сбор статистики по пользователям
            let statsWhere = '1=1';
            const statsParams = [];

            if (search) {
                statsWhere += ' AND (u.tg_id LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)';
                statsParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            // фильтр по боту для статистики
            let botExistsClause = '';
            if (botId !== null) {
                botExistsClause = ' AND EXISTS (SELECT 1 FROM user_bots ub WHERE ub.user_id = u.id AND ub.bot_id = ?)';
                statsParams.push(botId);
            }

            // Проверяем, есть ли столбец is_premium
            const [premCheckRows] = await db.execute(
                `SELECT COUNT(*) AS cnt
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'
           AND COLUMN_NAME = 'is_premium'`
            );
            const hasPremium = (premCheckRows?.[0]?.cnt || 0) > 0;

            // сводные счётчики по пользователям
            const statsQuery = `
        SELECT
          COUNT(*)                                           AS total,
          SUM(u.is_blocked = 0)                              AS active,
          SUM(u.is_blocked = 1)                              AS blocked,
          SUM(DATE(u.created_at) = CURDATE())                AS todayRegistrations,
          ${hasPremium ? 'SUM(u.is_premium = 1)' : '0'}      AS premium
        FROM users u
        WHERE ${statsWhere} ${botExistsClause}
      `;
            const [statsRows] = await db.execute(statsQuery, statsParams);
            const baseStats = statsRows?.[0] || {
                total: 0, active: 0, blocked: 0, todayRegistrations: 0, premium: 0
            };

            const volumeParams = [];
            let volumeUsersFilter = '1=1';
            if (search) {
                volumeUsersFilter += ' AND (u.tg_id LIKE ? OR u.username LIKE ? OR u.phone LIKE ?)';
                volumeParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            if (botId !== null) {
                volumeUsersFilter += ' AND EXISTS (SELECT 1 FROM user_bots ub WHERE ub.user_id = u.id AND ub.bot_id = ?)';
                volumeParams.push(botId);
            }

            const volumeQuery = `
        SELECT COALESCE(SUM(o.sum_rub), 0) AS totalVolume
        FROM orders o
        WHERE EXISTS (
          SELECT 1
          FROM users u
          WHERE u.id = o.user_id AND ${volumeUsersFilter}
        )
      `;
            const [volumeRows] = await db.execute(volumeQuery, volumeParams);
            const totalVolume = volumeRows?.[0]?.totalVolume || 0;

            const stats = {
                total: Number(baseStats.total) || 0,
                active: Number(baseStats.active) || 0,
                premium: Number(baseStats.premium) || 0,
                blocked: Number(baseStats.blocked) || 0,
                todayRegistrations: Number(baseStats.todayRegistrations) || 0,
                totalVolume: Number(totalVolume) || 0
            };


            res.json({
                users: users || [],
                stats,
                total: total || 0,
                pages: Math.ceil((total || 0) / limitNum),
                currentPage: pageNum
            });
        } catch (error) {
            console.error('Get users error:', error);
            res.json({
                users: [],
                stats: {
                    total: 0,
                    active: 0,
                    premium: 0,
                    blocked: 0,
                    todayRegistrations: 0,
                    totalVolume: 0
                },
                total: 0,
                pages: 0,
                currentPage: 1,
                error: 'Ошибка при получении пользователей'
            });
        }
    }


    // получение пользователя по ID или tg_id
    async getUserById(req, res) {
        try {
            const { id } = req.params;
            const db = getConnection();

            let whereCondition = 'u.id = ?';
            let paramValue = id;

            if (isNaN(parseInt(id))) {
                whereCondition = 'u.tg_id = ?';
                paramValue = id;
            } else {
                const numId = parseInt(id);
                if (numId > 100000000) {
                    whereCondition = 'u.tg_id = ?';
                    paramValue = id;
                }
            }

            if (req.user.role === 'EX_ADMIN') {
                const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
                if (botResult.length === 0) {
                    return res.status(404).json({ error: 'Bot not found for admin' });
                }
                const adminBotId = botResult[0].id;

                const userCheckCondition = whereCondition.replace('u.', 'ub.');
                const [userBotCheck] = await db.execute(
                    `SELECT 1 FROM users u JOIN user_bots ub ON u.id = ub.user_id WHERE ${whereCondition} AND ub.bot_id = ?`,
                    [paramValue, adminBotId]
                );
                if (userBotCheck.length === 0) {
                    return res.status(403).json({ error: 'Access denied to this user' });
                }
            }

            const [users] = await db.execute(`
                SELECT 
                    u.*,
                    GROUP_CONCAT(DISTINCT b.name) as bot_names,
                    GROUP_CONCAT(DISTINCT b.id) as bot_ids
                FROM users u
                LEFT JOIN user_bots ub ON u.id = ub.user_id
                LEFT JOIN bots b ON ub.bot_id = b.id
                WHERE ${whereCondition}
                GROUP BY u.id
            `, [paramValue]);

            if (users.length === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            const userData = users[0];
            const userId = userData.id;

            const [orderStats] = await db.execute(`
                SELECT 
                    COUNT(*) as orders_count,
                    COALESCE(SUM(sum_rub), 0) as total_volume,
                    COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as completed_orders,
                    COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) as cancelled_orders,
                    COALESCE(SUM(CASE WHEN dir = 'BUY' THEN 1 ELSE 0 END), 0) as buy_orders,
                    COALESCE(SUM(CASE WHEN dir = 'SELL' THEN 1 ELSE 0 END), 0) as sell_orders,
                    COALESCE(AVG(sum_rub), 0) as avg_order_amount,
                    MIN(created_at) as first_order_date,
                    MAX(created_at) as last_order_date
                FROM orders
                WHERE user_id = ?
            `, [userId]);

            const [recentOrders] = await db.execute(`
                SELECT 
                    o.id,
                    o.unique_id, 
                    o.dir,
                    o.coin,
                    o.amount_coin,
                    o.sum_rub,
                    o.status, 
                    o.created_at,
                    o.completed_at,
                    b.name as bot_name
                FROM orders o
                LEFT JOIN bots b ON o.bot_id = b.id
                WHERE o.user_id = ?
                ORDER BY o.created_at DESC
                LIMIT 10
            `, [userId]);

            const [userBots] = await db.execute(`
                SELECT 
                    ub.*,
                    b.name as bot_name,
                    b.identifier as bot_identifier,
                    rb_invited.referral_code as invited_by_code,
                    u_inviter.username as inviter_username
                FROM user_bots ub
                LEFT JOIN bots b ON ub.bot_id = b.id
                LEFT JOIN user_bots rb_invited ON ub.invited_by = rb_invited.id
                LEFT JOIN users u_inviter ON rb_invited.user_id = u_inviter.id
                WHERE ub.user_id = ?
            `, [userId]);

            const [referralStats] = await db.execute(`
                SELECT 
                    COUNT(DISTINCT invited.user_id) as total_referrals,
                    COUNT(DISTINCT CASE 
                        WHEN order_stats.orders_count > 0 THEN invited.user_id 
                        ELSE NULL 
                    END) as active_referrals,
                    COALESCE(SUM(order_stats.orders_count), 0) as referral_orders,
                    COALESCE(SUM(order_stats.total_volume), 0) as referral_volume
                FROM user_bots inviter
                LEFT JOIN user_bots invited ON invited.invited_by = inviter.id
                LEFT JOIN (
                    SELECT 
                        user_id,
                        COUNT(*) as orders_count,
                        SUM(sum_rub) as total_volume
                    FROM orders
                    GROUP BY user_id
                ) order_stats ON invited.user_id = order_stats.user_id
                WHERE inviter.user_id = ?
            `, [userId]);

            const [referralBonuses] = await db.execute(`
                SELECT 
                    COALESCE(SUM(rb.bonus_amount), 0) as total_bonuses,
                    COUNT(*) as bonus_transactions,
                    MAX(rb.created_at) as last_bonus_date
                FROM referral_bonuses rb
                JOIN user_bots ub ON rb.referrer_userbot_id = ub.id
                WHERE ub.user_id = ?
            `, [userId]);

            userData.orders_count = orderStats[0]?.orders_count || 0;
            userData.total_volume = orderStats[0]?.total_volume || 0;
            userData.completed_orders = orderStats[0]?.completed_orders || 0;
            userData.cancelled_orders = orderStats[0]?.cancelled_orders || 0;
            userData.buy_orders = orderStats[0]?.buy_orders || 0;
            userData.sell_orders = orderStats[0]?.sell_orders || 0;
            userData.avg_order_amount = orderStats[0]?.avg_order_amount || 0;
            userData.first_order_date = orderStats[0]?.first_order_date;
            userData.last_order_date = orderStats[0]?.last_order_date;

            userData.recent_orders = recentOrders;
            userData.user_bots = userBots;

            userData.referral_stats = {
                total_referrals: referralStats[0]?.total_referrals || 0,
                active_referrals: referralStats[0]?.active_referrals || 0,
                referral_orders: referralStats[0]?.referral_orders || 0,
                referral_volume: referralStats[0]?.referral_volume || 0
            };

            userData.referral_bonuses = {
                total_bonuses: referralBonuses[0]?.total_bonuses || 0,
                bonus_transactions: referralBonuses[0]?.bonus_transactions || 0,
                last_bonus_date: referralBonuses[0]?.last_bonus_date
            };

            res.json(userData);
        } catch (error) {
            console.error('Get user by ID error:', error);
            res.status(500).json({ error: 'Ошибка при получении пользователя' });
        }
    }

    // получение рефералов пользователя
    async getUserReferrals(req, res) {
        try {
            const { id } = req.params;
            const { page = 1, limit = 10 } = req.query;
            const db = getConnection();

            // определяем условие поиска пользователя (по ID или tg_id)
            let whereCondition = 'id = ?';
            let paramValue = id;

            if (isNaN(parseInt(id))) {
                whereCondition = 'tg_id = ?';
                paramValue = id;
            } else {
                const numId = parseInt(id);
                if (numId > 100000000) {
                    whereCondition = 'tg_id = ?';
                    paramValue = id;
                }
            }

            const [userResult] = await db.execute(`SELECT id FROM users WHERE ${whereCondition}`, [paramValue]);
            if (userResult.length === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            const userId = userResult[0].id;

            if (req.user.role === 'EX_ADMIN') {
                const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
                if (botResult.length === 0) {
                    return res.status(404).json({ error: 'Bot not found for admin' });
                }
                const adminBotId = botResult[0].id;

                const [userBotCheck] = await db.execute(
                    'SELECT 1 FROM user_bots WHERE user_id = ? AND bot_id = ?',
                    [userId, adminBotId]
                );
                if (userBotCheck.length === 0) {
                    return res.status(403).json({ error: 'Access denied to this user' });
                }
            }

            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 10;
            const offset = (pageNum - 1) * limitNum;
            const [referrals] = await db.execute(`
                SELECT 
                    u.id,
                    u.tg_id,
                    u.username,
                    u.created_at as registered_at,
                    ub_invited.referral_level,
                    ub_invited.referral_bonus_balance,
                    b.name as bot_name,
                    COALESCE(order_stats.orders_count, 0) as orders_count,
                    COALESCE(order_stats.total_volume, 0) as total_volume,
                    COALESCE(order_stats.last_order_date, NULL) as last_order_date,
                    COALESCE(bonus_stats.total_bonuses, 0) as earned_bonuses
                FROM user_bots ub_inviter
                JOIN user_bots ub_invited ON ub_invited.invited_by = ub_inviter.id
                JOIN users u ON ub_invited.user_id = u.id
                LEFT JOIN bots b ON ub_invited.bot_id = b.id
                LEFT JOIN (
                    SELECT 
                        user_id,
                        COUNT(*) as orders_count,
                        SUM(sum_rub) as total_volume,
                        MAX(created_at) as last_order_date
                    FROM orders
                    GROUP BY user_id
                ) order_stats ON u.id = order_stats.user_id
                LEFT JOIN (
                    SELECT 
                        rb.referred_userbot_id,
                        SUM(rb.bonus_amount) as total_bonuses
                    FROM referral_bonuses rb
                    GROUP BY rb.referred_userbot_id
                ) bonus_stats ON ub_invited.id = bonus_stats.referred_userbot_id
                WHERE ub_inviter.user_id = ?
                ORDER BY u.created_at DESC
                LIMIT ${limitNum} OFFSET ${offset}
            `, [userId]);

            const [countResult] = await db.execute(`
                SELECT COUNT(*) as total
                FROM user_bots ub_inviter
                JOIN user_bots ub_invited ON ub_invited.invited_by = ub_inviter.id
                WHERE ub_inviter.user_id = ?
            `, [userId]);

            const total = countResult[0]?.total || 0;

            res.json({
                referrals,
                total,
                pages: Math.ceil(total / limitNum),
                currentPage: pageNum
            });
        } catch (error) {
            console.error('Get user referrals error:', error);
            res.status(500).json({ error: 'Ошибка при получении рефералов' });
        }
    }

    // обновление скидки пользователя
    async updateUserDiscount(req, res) {
        try {
            const { id } = req.params; 
            const { discount } = req.body;
            const db = getConnection();

            if (discount < 0 || discount > 50) {
                return res.status(400).json({ error: 'Скидка должна быть от 0 до 50%' });
            }

            if (req.user.role === 'EX_ADMIN') {
                const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
                if (botResult.length === 0) {
                    return res.status(404).json({ error: 'Bot not found for admin' });
                }
                const adminBotId = botResult[0].id;

                const [userBotCheck] = await db.execute(
                    'SELECT 1 FROM user_bots WHERE user_id = ? AND bot_id = ?',
                    [id, adminBotId]
                );
                if (userBotCheck.length === 0) {
                    return res.status(403).json({ error: 'Access denied to this user' });
                }
            }

            const [result] = await db.execute(
                'UPDATE users SET discount_v = ? WHERE id = ?',
                [discount, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            res.json({ message: 'Скидка обновлена', discount });
        } catch (error) {
            console.error('Update user discount error:', error);
            res.status(500).json({ error: 'Ошибка при обновлении скидки' });
        }
    }

    // блокировка пользователя
    async blockUser(req, res) {
        try {
            const { id } = req.params;
            const db = getConnection();

            if (req.user.role === 'EX_ADMIN') {
                const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
                if (botResult.length === 0) {
                    return res.status(404).json({ error: 'Bot not found for admin' });
                }
                const adminBotId = botResult[0].id;

                const [userBotCheck] = await db.execute(
                    'SELECT u.id FROM users u JOIN user_bots ub ON u.id = ub.user_id WHERE u.tg_id = ? AND ub.bot_id = ?',
                    [id, adminBotId]
                );
                if (userBotCheck.length === 0) {
                    return res.status(403).json({ error: 'Access denied to this user' });
                }
            }

            const [result] = await db.execute(
                'UPDATE users SET is_blocked = 1 WHERE tg_id = ?',
                [id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            res.json({ message: 'Пользователь заблокирован' });
        } catch (error) {
            console.error('Block user error:', error);
            res.status(500).json({ error: 'Ошибка при блокировке пользователя' });
        }
    }

    // разблокировка пользователя
    async unblockUser(req, res) {
        try {
            const { id } = req.params;
            const db = getConnection();

            if (req.user.role === 'EX_ADMIN') {
                const [botResult] = await db.execute('SELECT id FROM bots WHERE owner_id = ?', [req.user.id]);
                if (botResult.length === 0) {
                    return res.status(404).json({ error: 'Bot not found for admin' });
                }
                const adminBotId = botResult[0].id;

                const [userBotCheck] = await db.execute(
                    'SELECT u.id FROM users u JOIN user_bots ub ON u.id = ub.user_id WHERE u.tg_id = ? AND ub.bot_id = ?',
                    [id, adminBotId]
                );
                if (userBotCheck.length === 0) {
                    return res.status(403).json({ error: 'Access denied to this user' });
                }
            }

            const [result] = await db.execute(
                'UPDATE users SET is_blocked = 0 WHERE tg_id = ?',
                [id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            res.json({ message: 'Пользователь разблокирован' });
        } catch (error) {
            console.error('Unblock user error:', error);
            res.status(500).json({ error: 'Ошибка при разблокировке пользователя' });
        }
    }

    // счётчик общей статистики по пользователям
    async calculateUserStats() {
        try {
            const db = getConnection();
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const [userStats] = await db.execute(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) as active,
          0 as blocked,
          COUNT(CASE WHEN discount_v > 0 THEN 1 END) as premium,
          COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN 1 END) as todayRegistrations
        FROM users
      `);

            const [volumeStats] = await db.execute(`
        SELECT COALESCE(SUM(sum_rub), 0) as total_volume
        FROM orders
      `);

            const stats = userStats[0];
            const volume = volumeStats[0];

            return {
                total: stats.total,
                active: stats.active,
                premium: stats.premium,
                blocked: stats.blocked,
                todayRegistrations: stats.todayRegistrations,
                totalVolume: volume.total_volume
            };
        } catch (error) {
            console.error('Calculate user stats error:', error);
            return {
                total: 0,
                active: 0,
                premium: 0,
                blocked: 0,
                todayRegistrations: 0,
                totalVolume: 0
            };
        }
    }
}

module.exports = new UserController();