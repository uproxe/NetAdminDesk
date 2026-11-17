// Вывод проверок PostgreSQL для предпросмотра. Снят на настоящем PostgreSQL 16 (одноразовый кластер
// в среде сборки) с созданными для демонстрации проблемами: раздутая таблица и неактивный слот репликации.
// Изменено вручную: время работы сервера (14 дней) и пустой журнал ошибок.
// MySQL / MariaDB на «демо-сервере» не установлен — его проверки отвечают NO_CLIENT.
export const DB_SAMPLE: Record<string, string[]> = {
  "db-pg-service": [
    "16 main 5432 online postgres /var/lib/postgresql/16/main /var/log/postgresql/postgresql-16-main.log",
    "",
    ""
  ],
  "db-pg-conn": [
    "1|100|1|0|1209600|16.15",
    "99.8|0|6136997"
  ],
  "db-pg-locks": [
    "",
    "",
    ""
  ],
  "db-pg-disk": [
    "DIR=/var/lib/postgresql/16/main\n/dev/vda         264212084 12759704  31199876      30% /\nWAL=134217728",
    "shop|44301335\ncrm|9346071\npostgres|7871511"
  ],
  "db-pg-replication": [
    "f",
    "",
    "old_replica|f|94908664",
    ""
  ],
  "db-pg-maint": [
    "postgres|8187\ntemplate1|8187\ntemplate0|8187\nshop|8187\ncrm|8187",
    "shop|orders|300000|100000|-1",
    "on"
  ]
};
