import React, { useState, useEffect } from 'react';
import { supportsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import PageTransition from '../components/PageTransition';
import { toast } from 'react-toastify';
import {
  Trophy,
  Star,
  Zap,
  Users,
  TrendingUp,
  Award,
  Crown,
  Medal
} from 'lucide-react';

const OperatorsRatingPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [operatorsRating, setOperatorsRating] = useState([]);
  const [myRating, setMyRating] = useState(null);

  useEffect(() => {
    fetchRating();
  }, []);

  const fetchRating = async () => {
    try {
      setLoading(true);
      const response = await supportsApi.getOperatorsRating();
      console.log('Rating data:', response.data);
      
      if (response.data) {
        setOperatorsRating(response.data.top || []);
        setMyRating(response.data.current || null);
      }
    } catch (error) {
      console.error('Failed to fetch operators rating:', error);
      toast.error('Ошибка при загрузке рейтинга операторов');
    } finally {
      setLoading(false);
    }
  };

  const getRankIcon = (position) => {
    switch (position) {
      case 1:
        return <Crown className="w-7 h-7" style={{ color: '#FFD700' }} strokeWidth={2} />;
      case 2:
        return <Medal className="w-7 h-7" style={{ color: '#C0C0C0' }} strokeWidth={2} />;
      case 3:
        return <Medal className="w-7 h-7" style={{ color: '#CD7F32' }} strokeWidth={2} />;
      default:
        return <span className="text-lg font-bold text-gray-600 dark:text-gray-400">#{position}</span>;
    }
  };

  const renderStars = (rating) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${
              star <= Math.round(rating)
                ? 'text-yellow-500 fill-yellow-500'
                : 'text-gray-300 dark:text-gray-600'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <PageTransition>
      <div className="space-y-6">
        {/* заголовок */}
        <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-50/30 via-orange-50/20 to-red-50/30 dark:from-yellow-950/20 dark:via-orange-950/10 dark:to-red-950/20"></div>
          
          <div className="relative px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-xl shadow-lg">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold bg-gradient-to-r from-gray-900 via-yellow-800 to-orange-900 dark:from-gray-100 dark:via-yellow-200 dark:to-orange-100 bg-clip-text text-transparent">
                  Топ операторов
                </h1>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Рейтинг лучших операторов по отзывам и скорости работы
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* карточка текущего оператора */}
        {user?.role === 'OPERATOR' && myRating && (
          <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-indigo-50/20 to-purple-50/30 dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-purple-950/20"></div>
            
            <div className="relative p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 sm:p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg flex-shrink-0">
                    <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Ваш рейтинг
                  </h2>
                </div>
                <div className="px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl shadow-lg self-start sm:self-auto">
                  <span className="text-xs sm:text-sm font-medium text-blue-100">Позиция:</span>
                  <span className="text-xl sm:text-2xl font-bold text-white ml-2">
                    #{myRating.position || '-'}
                  </span>
                </div>
              </div>

              {/* рейтинги */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                {/* общий рейтинг */}
                <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
                  <div className="absolute inset-0 bg-gradient-to-br from-yellow-50/50 via-transparent to-orange-50/30 dark:from-yellow-950/30 dark:via-transparent dark:to-orange-950/20 pointer-events-none"></div>
                  
                  <div className="relative p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-2.5 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-xl shadow-md group-hover:scale-105 transition-transform duration-300">
                        <Star className="text-white w-5 h-5 fill-white" />
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                        Общий рейтинг
                      </h3>
                      <p className="text-3xl font-bold bg-gradient-to-r from-yellow-600 to-orange-600 dark:from-yellow-400 dark:to-orange-400 bg-clip-text text-transparent">
                        {myRating.rating?.overall_rating?.toFixed(1) || '0.0'}
                      </p>
                      <div className="pt-1">
                        {renderStars(myRating.rating?.overall_rating || 0)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* рейтинг от клиентов */}
                <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
                  <div className="absolute inset-0 bg-gradient-to-br from-green-50/50 via-transparent to-emerald-50/30 dark:from-green-950/30 dark:via-transparent dark:to-emerald-950/20 pointer-events-none"></div>
                  
                  <div className="relative p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-2.5 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-md group-hover:scale-105 transition-transform duration-300">
                        <Users className="text-white w-5 h-5" />
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                        От клиентов
                      </h3>
                      <p className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 dark:from-green-400 dark:to-emerald-400 bg-clip-text text-transparent">
                        {myRating.rating?.user_rating?.toFixed(1) || '0.0'}
                      </p>
                      <div className="pt-1">
                        {renderStars(myRating.rating?.user_rating || 0)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* рейтинг по скорости */}
                <div className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-transparent to-red-50/30 dark:from-orange-950/30 dark:via-transparent dark:to-red-950/20 pointer-events-none"></div>
                  
                  <div className="relative p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="p-2.5 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl shadow-md group-hover:scale-105 transition-transform duration-300">
                        <Zap className="text-white w-5 h-5" />
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase">
                        По скорости
                      </h3>
                      <p className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-red-600 dark:from-orange-400 dark:to-red-400 bg-clip-text text-transparent">
                        {myRating.rating?.speed_rating?.toFixed(1) || '0.0'}
                      </p>
                      <div className="pt-1">
                        {renderStars(myRating.rating?.speed_rating || 0)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* стата */}
              <div className="flex flex-wrap items-center gap-3 sm:gap-6 pt-4 border-t border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Всего заявок:</span>
                  <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100">
                    {myRating.rating?.orders_count || 0}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                  <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">С оценками:</span>
                  <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100">
                    {myRating.rating?.details?.orders_with_ratings || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* топ */}
        <div className="relative overflow-hidden bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl shadow-lg rounded-2xl border border-gray-200/50 dark:border-gray-700/50">
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-50/20 via-orange-50/10 to-red-50/20 dark:from-yellow-950/10 dark:via-orange-950/5 dark:to-red-950/10"></div>
          
          <div className="relative p-4 sm:p-6">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 sm:mb-6 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500 flex-shrink-0" />
              <span>Топ 10 операторов</span>
            </h2>

            {loading ? (
              <div className="space-y-4">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
                ))}
              </div>
            ) : operatorsRating.length === 0 ? (
              <div className="text-center py-12">
                <Trophy className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Нет данных о рейтинге операторов</p>
              </div>
            ) : (
              <div className="space-y-3">
                {operatorsRating.map((operator, index) => {
                  const position = index + 1;
                  const isTopThree = position <= 3;
                  
                  return (
                    <div
                      key={operator.id}
                      className="group relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl shadow-lg hover:shadow-xl border border-gray-200/50 dark:border-gray-700/50 overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
                    >
                      {isTopThree && (
                        <div className="absolute inset-0 bg-gradient-to-br from-yellow-50/50 via-orange-50/20 to-red-50/30 dark:from-yellow-950/30 dark:via-orange-950/10 dark:to-red-950/20 pointer-events-none"></div>
                      )}
                      
                      <div className="relative p-3 sm:p-4 lg:p-5">
                        {/* на десктопе */}
                        <div className="hidden lg:flex items-center gap-5">
                          {/* иконка позиции */}
                          <div className="flex-shrink-0">
                            <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 shadow-md">
                              {getRankIcon(position)}
                            </div>
                          </div>

                          {/* информация об операторе */}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
                              {operator.username || `Оператор #${operator.id}`}
                            </h3>
                            <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                              <span className="flex items-center gap-1.5">
                                <TrendingUp className="w-3.5 h-3.5" />
                                <span className="font-medium">{operator.rating?.orders_count || 0}</span> заявок
                              </span>
                              {operator.rating?.details?.orders_with_ratings > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="flex items-center gap-1.5">
                                    <Star className="w-3.5 h-3.5 fill-yellow-500 text-yellow-500" />
                                    <span className="font-medium">{operator.rating.details.orders_with_ratings}</span> с оценками
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* рейтинги в компактных карточках */}
                          <div className="flex items-center gap-3">
                            {/* общий рейтинг */}
                            <div className="relative bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg px-4 py-3 border border-gray-200/50 dark:border-gray-700/50 min-w-[90px]">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Общий</span>
                              </div>
                              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
                                {operator.rating?.overall_rating?.toFixed(1) || '0.0'}
                              </div>
                              <div className="mt-1">
                                {renderStars(operator.rating?.overall_rating || 0)}
                              </div>
                            </div>

                            {/* от клиентов */}
                            <div className="relative bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg px-4 py-3 border border-gray-200/50 dark:border-gray-700/50 min-w-[90px]">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Users className="w-3.5 h-3.5 text-green-500" />
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Клиенты</span>
                              </div>
                              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
                                {operator.rating?.user_rating?.toFixed(1) || '0.0'}
                              </div>
                              <div className="mt-1">
                                {renderStars(operator.rating?.user_rating || 0)}
                              </div>
                            </div>

                            {/* по скорости */}
                            <div className="relative bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg px-4 py-3 border border-gray-200/50 dark:border-gray-700/50 min-w-[90px]">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Zap className="w-3.5 h-3.5 text-orange-500" />
                                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Скорость</span>
                              </div>
                              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
                                {operator.rating?.speed_rating?.toFixed(1) || '0.0'}
                              </div>
                              <div className="mt-1">
                                {renderStars(operator.rating?.speed_rating || 0)}
                              </div>
                            </div>
                          </div>

                        </div>

                        {/* мобильная  */}
                        <div className="lg:hidden space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0">
                              <div className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 shadow-md">
                                {getRankIcon(position)}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                                {operator.username || `Оператор #${operator.id}`}
                              </h3>
                              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                                <span className="flex items-center gap-1">
                                  <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
                                  <span className="font-medium">{operator.rating?.orders_count || 0}</span>
                                </span>
                                {operator.rating?.details?.orders_with_ratings > 0 && (
                                  <>
                                    <span className="hidden sm:inline">•</span>
                                    <span className="flex items-center gap-1">
                                      <Star className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-yellow-500 text-yellow-500 flex-shrink-0" />
                                      <span className="font-medium">{operator.rating.details.orders_with_ratings}</span>
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* рейтинг */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="relative bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 sm:p-3 border border-gray-200/50 dark:border-gray-700/50">
                              <div className="flex items-center gap-1 mb-1">
                                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                                <span className="text-[10px] sm:text-xs font-semibold text-gray-600 dark:text-gray-400 truncate">Общий</span>
                              </div>
                              <div className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">
                                {operator.rating?.overall_rating?.toFixed(1) || '0.0'}
                              </div>
                              <div className="mt-1 flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star
                                    key={star}
                                    className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${
                                      star <= Math.round(operator.rating?.overall_rating || 0)
                                        ? 'text-yellow-500 fill-yellow-500'
                                        : 'text-gray-300 dark:text-gray-600'
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>

                            {/* от клиентов */}
                            <div className="relative bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 sm:p-3 border border-gray-200/50 dark:border-gray-700/50">
                              <div className="flex items-center gap-1 mb-1">
                                <Users className="w-3 h-3 text-green-500 flex-shrink-0" />
                                <span className="text-[10px] sm:text-xs font-semibold text-gray-600 dark:text-gray-400 truncate">Клиенты</span>
                              </div>
                              <div className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">
                                {operator.rating?.user_rating?.toFixed(1) || '0.0'}
                              </div>
                              <div className="mt-1 flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star
                                    key={star}
                                    className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${
                                      star <= Math.round(operator.rating?.user_rating || 0)
                                        ? 'text-yellow-500 fill-yellow-500'
                                        : 'text-gray-300 dark:text-gray-600'
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>

                            {/* по скорости */}
                            <div className="relative bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 sm:p-3 border border-gray-200/50 dark:border-gray-700/50">
                              <div className="flex items-center gap-1 mb-1">
                                <Zap className="w-3 h-3 text-orange-500 flex-shrink-0" />
                                <span className="text-[10px] sm:text-xs font-semibold text-gray-600 dark:text-gray-400 truncate">Скорость</span>
                              </div>
                              <div className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">
                                {operator.rating?.speed_rating?.toFixed(1) || '0.0'}
                              </div>
                              <div className="mt-1 flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star
                                    key={star}
                                    className={`w-2.5 h-2.5 sm:w-3 sm:h-3 ${
                                      star <= Math.round(operator.rating?.speed_rating || 0)
                                        ? 'text-yellow-500 fill-yellow-500'
                                        : 'text-gray-300 dark:text-gray-600'
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  );
};

export default OperatorsRatingPage;
