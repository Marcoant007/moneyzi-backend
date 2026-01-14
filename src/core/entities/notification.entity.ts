export enum NotificationType {
    DUE_DATE_REMINDER = 'DUE_DATE_REMINDER',
    OVERDUE = 'OVERDUE',
    LOW_BALANCE = 'LOW_BALANCE',
    HIGH_EXPENSE = 'HIGH_EXPENSE',
    BUDGET_ALERT = 'BUDGET_ALERT',
    MONTHLY_SUMMARY = 'MONTHLY_SUMMARY',
    PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
}

export interface Notification {
    id: string
    userId: string
    type: NotificationType
    title: string
    message: string
    isRead: boolean
    transactionId?: string
    createdAt: Date
    updatedAt: Date
}

export interface CreateNotificationInput {
    userId: string
    type: NotificationType
    title: string
    message: string
    transactionId?: string
}
