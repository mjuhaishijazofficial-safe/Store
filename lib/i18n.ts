// ============================================================
// i18n dictionary — Roman Urdu (default) + English.
// Every user-facing string in the app should live here.
// ============================================================

export type Lang = 'ur' | 'en';

export const LANG_COOKIE = 'lang';
export const DEFAULT_LANG: Lang = 'ur';

export const dict = {
  // nav / shell
  'nav.overview': { ur: 'Overview', en: 'Overview' },
  'nav.inventory': { ur: 'Saman', en: 'Inventory' },
  'nav.reorder': { ur: 'Mangwana Hai', en: 'Reorder' },
  'nav.khata': { ur: 'Khata', en: 'Khata' },
  'nav.history': { ur: 'History', en: 'History' },
  'nav.billing': { ur: 'Billing', en: 'Billing' },
  'nav.settings': { ur: 'Settings', en: 'Settings' },
  'nav.signout': { ur: 'Sign Out', en: 'Sign Out' },

  'lock.title': { ur: 'Trial khatam ho gaya', en: 'Trial has ended' },
  'lock.body': { ur: 'Apna subscription active karein taake dukaan ka data use karte rahein.', en: 'Activate your subscription to keep using your shop data.' },
  'lock.cta': { ur: 'Subscribe Karein', en: 'Subscribe' },

  // landing
  'landing.login': { ur: 'Login', en: 'Login' },
  'landing.freeTrialNav': { ur: 'Free Trial Shuru Karein', en: 'Start Free Trial' },
  'landing.heroLine1': { ur: 'Apni Dukaan ka', en: 'Your Whole Shop,' },
  'landing.heroLine1Highlight': { ur: 'Poora Hisaab', en: 'One Ledger' },
  'landing.heroLine2': { ur: 'Phone Par', en: 'On Your Phone' },
  'landing.heroBody': { ur: 'Stock, budget, purchases aur bikri — sab digital, sab live. 14 din free trial, phir mahana subscription.', en: 'Stock, budget, purchases and sales — all digital, all live. 14-day free trial, then a monthly subscription.' },
  'landing.heroCta': { ur: 'Abhi Shuru Karein — Free', en: 'Start Now — Free' },
  'landing.feature1Title': { ur: 'Stock Tracking', en: 'Stock Tracking' },
  'landing.feature1Body': { ur: 'Kitna saman hai, kitna baki hai — real-time.', en: 'How much stock you have, in real time.' },
  'landing.feature2Title': { ur: 'Reorder Alerts', en: 'Reorder Alerts' },
  'landing.feature2Body': { ur: 'Jo saman kam ho jaye, automatically list mein aa jaye.', en: 'Low-stock items land on your reorder list automatically.' },
  'landing.feature3Title': { ur: 'Budget Control', en: 'Budget Control' },
  'landing.feature3Body': { ur: 'Kitna kharch hua, kitna baki budget hai — ek nazar mein.', en: 'What you’ve spent, what’s left — at a glance.' },
  'landing.pricingTitle': { ur: 'Simple Pricing', en: 'Simple Pricing' },
  'landing.pricingSuffix': { ur: '/mahina', en: '/month' },
  'landing.pricingBody': { ur: 'Per dukaan. 14 din free trial, koi card nahi chahiye.', en: 'Per shop. 14-day free trial, no card required.' },

  // auth
  'auth.signupTitle': { ur: 'Naya Account', en: 'New Account' },
  'auth.signupSub': { ur: '14 din free trial — koi card nahi chahiye', en: '14-day free trial — no card required' },
  'auth.shopName': { ur: 'Dukaan ka naam', en: 'Shop name' },
  'auth.yourName': { ur: 'Aap ka naam', en: 'Your name' },
  'auth.email': { ur: 'Email', en: 'Email' },
  'auth.password': { ur: 'Password', en: 'Password' },
  'auth.passwordHint': { ur: 'Kam se kam 6 characters', en: 'At least 6 characters' },
  'auth.creating': { ur: 'Bana rahe hain...', en: 'Creating...' },
  'auth.createAccount': { ur: 'Account Banayein', en: 'Create Account' },
  'auth.haveAccount': { ur: 'Pehle se account hai?', en: 'Already have an account?' },
  'auth.loginLink': { ur: 'Login karein', en: 'Log in' },
  'auth.loginTitle': { ur: 'Login', en: 'Login' },
  'auth.loggingIn': { ur: 'Login ho raha hai...', en: 'Logging in...' },
  'auth.loginBtn': { ur: 'Login Karein', en: 'Log In' },
  'auth.noAccount': { ur: 'Account nahi hai?', en: 'Don’t have an account?' },
  'auth.signupLink': { ur: 'Free trial shuru karein', en: 'Start free trial' },

  // overview
  'overview.title': { ur: 'Overview', en: 'Overview' },
  'overview.totalBudget': { ur: 'Kul Budget', en: 'Total Budget' },
  'overview.spent': { ur: 'Kharch Hua', en: 'Spent' },
  'overview.remaining': { ur: 'Baki Budget', en: 'Remaining' },
  'overview.totalItems': { ur: 'Total items in inventory', en: 'Total items in inventory' },
  'overview.itemsToReorder': { ur: 'Items jo mangwane hain', en: 'Items to reorder' },
  'overview.dailyReport': { ur: 'Aaj ka Hisaab Dekhein →', en: "View Today's Summary →" },

  // daily closing report
  'reports.title': { ur: 'Aaj ka Hisaab', en: 'Today’s Summary' },
  'reports.subtitle': { ur: 'Aaj ki saari activity ek nazar mein', en: 'All of today’s activity at a glance' },
  'reports.totalSales': { ur: 'Total Bikri', en: 'Total Sales' },
  'reports.stockPurchased': { ur: 'Naya Maal (Kharch)', en: 'Stock Purchased' },
  'reports.udhaarDiya': { ur: 'Udhaar Diya', en: 'Credit Given' },
  'reports.paymentMila': { ur: 'Payment Mila', en: 'Payments Received' },
  'reports.shareWhatsapp': { ur: 'WhatsApp Par Share Karein', en: 'Share on WhatsApp' },
  'reports.summaryMsg': {
    ur: '{shop} — Aaj ka Hisaab\nBikri: Rs. {sales}\nUdhaar diya: Rs. {given}\nPayment mila: Rs. {received}\nNaya maal: Rs. {stock}',
    en: '{shop} — Today’s Summary\nSales: Rs. {sales}\nCredit given: Rs. {given}\nPayments received: Rs. {received}\nStock purchased: Rs. {stock}'
  },

  // inventory
  'inventory.search': { ur: 'Saman dhoondein...', en: 'Search items...' },
  'inventory.addNew': { ur: '+ Naya', en: '+ New' },
  'inventory.loading': { ur: 'Load ho raha hai...', en: 'Loading...' },
  'inventory.emptyTitle': { ur: 'Koi saman nahi mila', en: 'No items found' },
  'inventory.emptyBody': { ur: '"+ Naya" par tap kar ke item add karein', en: 'Tap "+ New" to add an item' },
  'inventory.alertLevel': { ur: 'Alert level', en: 'Alert level' },
  'inventory.stockIn': { ur: '+ Maal Aaya', en: '+ Stock In' },
  'inventory.stockOut': { ur: '− Bik/Use Hua', en: '− Stock Out' },
  'inventory.edit': { ur: 'Edit', en: 'Edit' },
  'inventory.editItemTitle': { ur: 'Saman Edit Karein', en: 'Edit Item' },
  'inventory.newItemTitle': { ur: 'Naya Saman', en: 'New Item' },
  'inventory.name': { ur: 'Naam', en: 'Name' },
  'inventory.category': { ur: 'Category', en: 'Category' },
  'inventory.stock': { ur: 'Stock', en: 'Stock' },
  'inventory.unit': { ur: 'Unit', en: 'Unit' },
  'inventory.unitPlaceholder': { ur: 'kg / packet', en: 'kg / packet' },
  'inventory.price': { ur: 'Price/unit', en: 'Price/unit' },
  'inventory.cancel': { ur: 'Cancel', en: 'Cancel' },
  'inventory.save': { ur: 'Save', en: 'Save' },
  'inventory.deleteItem': { ur: 'Ye saman hata dein', en: 'Delete this item' },
  'inventory.newStockTitle': { ur: 'Naya Maal — ', en: 'New Stock — ' },
  'inventory.outStockTitle': { ur: 'Bik/Use Hua — ', en: 'Stock Out — ' },
  'inventory.quantity': { ur: 'Quantity', en: 'Quantity' },
  'inventory.totalAmount': { ur: 'Total amount (₨) — budget se katega', en: 'Total amount (₨) — deducted from budget' },
  'inventory.confirm': { ur: 'Confirm', en: 'Confirm' },

  // reorder
  'reorder.title': { ur: 'Mangwana Hai', en: 'Reorder' },
  'reorder.subtitle': { ur: 'item(s) jo kam ho gaye hain', en: 'item(s) running low' },
  'reorder.allGoodTitle': { ur: 'Sab theek hai', en: 'All good' },
  'reorder.allGoodBody': { ur: 'Filhaal koi saman kam nahi hai', en: 'Nothing is running low right now' },
  'reorder.abhi': { ur: 'Abhi', en: 'Now' },
  'reorder.alert': { ur: 'Alert', en: 'Alert' },
  'reorder.orderQty': { ur: 'mangwayein', en: 'to order' },
  'reorder.estCost': { ur: 'Andaza lagat', en: 'Est. cost' },

  // history
  'history.title': { ur: 'History — Purchases & Bikri', en: 'History — Purchases & Sales' },
  'history.empty': { ur: 'Abhi tak koi entry nahi', en: 'No entries yet' },
  'history.purchaseIn': { ur: 'Naya maal aaya', en: 'Stock received' },
  'history.saleOut': { ur: 'Bik/use hua', en: 'Sold/used' },

  // khata list
  'khata.search': { ur: 'Customer dhoondein...', en: 'Search customers...' },
  'khata.addCustomer': { ur: '+ Naya Customer', en: '+ New Customer' },
  'khata.loading': { ur: 'Load ho raha hai...', en: 'Loading...' },
  'khata.emptyTitle': { ur: 'Koi customer nahi mila', en: 'No customers found' },
  'khata.emptyBody': { ur: '"+ Naya Customer" par tap kar ke add karein', en: 'Tap "+ New Customer" to add one' },
  'khata.overLimit': { ur: 'Limit se zyada', en: 'Over limit' },
  'khata.newCustomerTitle': { ur: 'Naya Customer', en: 'New Customer' },
  'khata.name': { ur: 'Naam', en: 'Name' },
  'khata.phone': { ur: 'Phone', en: 'Phone' },
  'khata.creditLimit': { ur: 'Credit limit (₨) — optional', en: 'Credit limit (₨) — optional' },
  'khata.cancel': { ur: 'Cancel', en: 'Cancel' },
  'khata.save': { ur: 'Save', en: 'Save' },

  // khata detail
  'khataDetail.back': { ur: '← Sab Customers', en: '← All Customers' },
  'khataDetail.totalUdhaar': { ur: 'Total Udhaar', en: 'Total Owed' },
  'khataDetail.overLimit': { ur: 'Credit limit se zyada ho gaya hai', en: 'Over credit limit' },
  'khataDetail.newSaman': { ur: '+ Naya Saman Diya', en: '+ New Item Given' },
  'khataDetail.paymentReceived': { ur: '+ Payment Mili', en: '+ Payment Received' },
  'khataDetail.empty': { ur: 'Abhi tak koi entry nahi', en: 'No entries yet' },
  'khataDetail.paymentLabel': { ur: 'Payment mili', en: 'Payment received' },
  'khataDetail.itemDefault': { ur: 'Saman', en: 'Item' },
  'khataDetail.loading': { ur: 'Load ho raha hai...', en: 'Loading...' },
  'khataDetail.notFound': { ur: 'Customer nahi mila', en: 'Customer not found' },
  'khataDetail.itemName': { ur: 'Saman ka naam', en: 'Item name' },
  'khataDetail.itemPlaceholder': { ur: 'e.g. Coca Cola', en: 'e.g. Coca Cola' },
  'khataDetail.qtyOptional': { ur: 'Quantity — optional', en: 'Quantity — optional' },
  'khataDetail.amount': { ur: 'Amount (₨)', en: 'Amount (₨)' },
  'khataDetail.noteOptional': { ur: 'Note — optional', en: 'Note — optional' },
  'khataDetail.cancel': { ur: 'Cancel', en: 'Cancel' },
  'khataDetail.save': { ur: 'Save', en: 'Save' },
  'khataDetail.limitWarning': { ur: 'Ye entry credit limit se zyada kar degi', en: 'This entry will put them over their credit limit' },
  'khataDetail.remindWhatsapp': { ur: 'WhatsApp par Yaad Dilayein', en: 'Remind on WhatsApp' },
  'khataDetail.reminderMsg': { ur: 'Aapka udhaar Rs. {amount} hai — {shop}', en: 'Your outstanding balance is Rs. {amount} — {shop}' },
  'khataDetail.fromInventory': { ur: 'Inventory se', en: 'From inventory' },

  // suppliers (reverse khata)
  'nav.suppliers': { ur: 'Supplier', en: 'Suppliers' },
  'suppliers.search': { ur: 'Supplier dhoondein...', en: 'Search suppliers...' },
  'suppliers.addSupplier': { ur: '+ Naya Supplier', en: '+ New Supplier' },
  'suppliers.loading': { ur: 'Load ho raha hai...', en: 'Loading...' },
  'suppliers.emptyTitle': { ur: 'Koi supplier nahi mila', en: 'No suppliers found' },
  'suppliers.emptyBody': { ur: '"+ Naya Supplier" par tap kar ke add karein', en: 'Tap "+ New Supplier" to add one' },
  'suppliers.newSupplierTitle': { ur: 'Naya Supplier', en: 'New Supplier' },
  'suppliers.name': { ur: 'Naam', en: 'Name' },
  'suppliers.phone': { ur: 'Phone', en: 'Phone' },
  'suppliers.cancel': { ur: 'Cancel', en: 'Cancel' },
  'suppliers.save': { ur: 'Save', en: 'Save' },
  'suppliers.youOwe': { ur: 'Aap Par Udhaar', en: 'You Owe' },
  'suppliersDetail.back': { ur: '← Sab Suppliers', en: '← All Suppliers' },
  'suppliersDetail.totalOwed': { ur: 'Aap Par Udhaar', en: 'Total You Owe' },
  'suppliersDetail.maalLiya': { ur: '+ Maal Liya', en: '+ Stock Received' },
  'suppliersDetail.paymentDi': { ur: '+ Payment Di', en: '+ Payment Made' },
  'suppliersDetail.empty': { ur: 'Abhi tak koi entry nahi', en: 'No entries yet' },
  'suppliersDetail.paymentLabel': { ur: 'Payment di', en: 'Payment made' },
  'suppliersDetail.itemDefault': { ur: 'Saman', en: 'Item' },
  'suppliersDetail.loading': { ur: 'Load ho raha hai...', en: 'Loading...' },
  'suppliersDetail.notFound': { ur: 'Supplier nahi mila', en: 'Supplier not found' },
  'suppliersDetail.itemName': { ur: 'Saman ka naam', en: 'Item name' },
  'suppliersDetail.itemPlaceholder': { ur: 'e.g. Cooking Oil', en: 'e.g. Cooking Oil' },
  'suppliersDetail.qtyOptional': { ur: 'Quantity — optional', en: 'Quantity — optional' },
  'suppliersDetail.amount': { ur: 'Amount (₨)', en: 'Amount (₨)' },
  'suppliersDetail.noteOptional': { ur: 'Note — optional', en: 'Note — optional' },
  'suppliersDetail.cancel': { ur: 'Cancel', en: 'Cancel' },
  'suppliersDetail.save': { ur: 'Save', en: 'Save' },

  // staff / multi-shop access
  'nav.staff': { ur: 'Staff', en: 'Staff' },
  'staff.title': { ur: 'Staff', en: 'Staff' },
  'staff.inviteTitle': { ur: 'Naya Staff Invite Karein', en: 'Invite Staff' },
  'staff.email': { ur: 'Email', en: 'Email' },
  'staff.inviteBtn': { ur: 'Invite Bhejein', en: 'Send Invite' },
  'staff.inviting': { ur: 'Bhej rahe hain...', en: 'Sending...' },
  'staff.invited': { ur: 'Invite bhej diya gaya ✓', en: 'Invite sent ✓' },
  'staff.roleOwner': { ur: 'Owner', en: 'Owner' },
  'staff.roleStaff': { ur: 'Staff', en: 'Staff' },
  'staff.ownerOnly': { ur: 'Ye page sirf owner dekh sakte hain.', en: 'Only the shop owner can view this page.' },

  // billing
  'billing.title': { ur: 'Billing', en: 'Billing' },
  'billing.currentStatus': { ur: 'Current Status', en: 'Current Status' },
  'billing.trialEnds': { ur: 'Trial khatam:', en: 'Trial ends:' },
  'billing.perShop': { ur: 'Per dukaan. Cancel kabhi bhi kar sakte hain.', en: 'Per shop. Cancel any time.' },
  'billing.perMonth': { ur: '/mahina', en: '/month' },
  'billing.statusTrialing': { ur: 'Free Trial', en: 'Free Trial' },
  'billing.statusActive': { ur: 'Active', en: 'Active' },
  'billing.statusPastDue': { ur: 'Payment Due', en: 'Payment Due' },
  'billing.statusCanceled': { ur: 'Canceled', en: 'Canceled' },
  'billing.manageSubscription': { ur: 'Subscription Manage Karein', en: 'Manage Subscription' },
  'billing.subscribe': { ur: 'Subscribe Karein', en: 'Subscribe' },
  'billing.loading': { ur: 'Loading...', en: 'Loading...' },

  // settings
  'settings.title': { ur: 'Settings', en: 'Settings' },
  'settings.shopName': { ur: 'Dukaan ka naam', en: 'Shop name' },
  'settings.totalBudget': { ur: 'Kul budget (₨)', en: 'Total budget (₨)' },
  'settings.save': { ur: 'Save Karein', en: 'Save' },
  'settings.saved': { ur: 'Save ho gaya ✓', en: 'Saved ✓' }
} as const;

export type DictKey = keyof typeof dict;

export function translate(key: DictKey, lang: Lang): string {
  return dict[key][lang];
}
