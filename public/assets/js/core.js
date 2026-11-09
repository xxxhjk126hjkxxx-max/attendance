/* ==========================================================================
   Core browser runtime: state store, i18n, API client, UI helpers.
   Plain ES module-free JS (loaded with defer) so it works without a bundler.
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------ state store
  const state = {
    user: null,
    csrf: null,
    lang: localStorage.getItem('attendance.lang') || 'ar',
    route: null,
    bootstrapped: false
  };
  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function setState(patch) {
    Object.assign(state, patch);
    listeners.forEach(fn => fn(state));
  }

  // ------------------------------------------------------------ i18n
  const translations = {
    en: {
      'app.name': 'University Attendance',
      'app.dept': 'Academic Affairs',
      'app.tagline': 'Attendance management platform',
      'nav.overview': 'Dashboard',
      'nav.attendance': 'Attendance',
      'nav.students': 'Students',
      'nav.qr': 'QR Codes',
      'nav.scanner': 'QR Scanner',
      'nav.courses': 'Courses',
      'nav.lectures': 'Lectures',
      'nav.reports': 'Reports',
      'nav.users': 'Administrators',
      'nav.audit': 'Audit Log',
      'nav.settings': 'Settings',
      'nav.group.main': 'Main',
      'nav.group.academic': 'Academic',
      'nav.group.admin': 'Administration',
      'login.title': 'Sign in to the portal',
      'login.subtitle': 'Use your university administrator credentials.',
      'login.identifier': 'Username or email',
      'login.password': 'Password',
      'login.submit': 'Sign in',
      'login.forgot': 'Forgot your password?',
      'login.hero': 'Attendance insights for every lecture, student and department.',
      'login.heroText': 'Track attendance across the university in real time, issue secure QR student cards, and produce audit-ready reports in Arabic and English.',
      'login.feature1': 'Live attendance analytics and absence alerts',
      'login.feature2': 'Secure QR cards with server-side validation',
      'login.feature3': 'Role-based access and full audit trail',
      'login.demo': 'Secure administrator access · Server-verified sessions',
      'login.invalid': 'Invalid username or password.',
      'login.required': 'Enter your username and password.',
      'login.throttled': 'Too many failed attempts. Please wait before trying again.',
      'logout': 'Sign out',
      'common.search': 'Search',
      'common.searchPlaceholder': 'Search students, ID, lecture…',
      'common.filter': 'Filter',
      'common.filters': 'Filters',
      'common.reset': 'Reset',
      'common.clear': 'Clear',
      'common.apply': 'Apply',
      'common.all': 'All',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.create': 'Create',
      'common.add': 'Add',
      'common.edit': 'Edit',
      'common.delete': 'Delete',
      'common.close': 'Close',
      'common.confirm': 'Confirm',
      'common.actions': 'Actions',
      'common.status': 'Status',
      'common.name': 'Name',
      'common.email': 'Email',
      'common.phone': 'Phone',
      'common.date': 'Date',
      'common.time': 'Time',
      'common.from': 'From',
      'common.to': 'To',
      'common.course': 'Course',
      'common.level': 'Academic level',
      'common.student': 'Student',
      'common.studentId': 'Student ID',
      'common.lectures': 'Lectures',
      'common.enrolled': 'Enrolled',
      'common.present': 'Present',
      'common.absent': 'Absent',
      'common.late': 'Late',
      'common.excused': 'Excused',
      'common.unmarked': 'Not recorded',
      'common.attendanceRate': 'Attendance rate',
      'common.loading': 'Loading…',
      'common.none': 'None',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.optional': 'optional',
      'common.required': 'required',
      'common.showing': 'Showing {from}–{to} of {total}',
      'common.page': 'Page',
      'common.of': 'of',
      'common.prev': 'Previous',
      'common.next': 'Next',
      'common.export': 'Export',
      'common.download': 'Download',
      'common.print': 'Print',
      'common.duplicate': 'Duplicate',
      'common.today': 'Today',
      'common.week': 'This week',
      'common.month': 'This month',
      'common.notes': 'Notes',
      'common.reason': 'Reason',
      'common.source': 'Source',
      'common.recordedBy': 'Recorded by',
      'common.recordedAt': 'Recorded at',
      'common.never': 'Never',
      'empty.title': 'Nothing to show yet',
      'empty.desc': 'Data will appear here once records are added.',
      'empty.search': 'No results found',
      'empty.searchDesc': 'Try a different search term or clear the filters.',
      'error.title': 'Something went wrong',
      'error.retry': 'Try again',
      'error.network': 'Network unavailable. Check your connection.',
      'error.session': 'Your session expired. Please sign in again.',
      'notif.loadFailed': 'Could not load data',
      'dash.title': 'Attendance overview',
      'dash.subtitle': 'Live figures from scheduled lectures and enrolled students.',
      'dash.eyebrow': 'Dashboard',
      'dash.totalStudents': 'Total students',
      'dash.presentToday': 'Present today',
      'dash.absentToday': 'Absent today',
      'dash.lateToday': 'Late arrivals',
      'dash.excused': 'Excused absences',
      'dash.rate': 'Attendance rate',
      'dash.totalCourses': 'Active courses',
      'dash.totalLectures': 'Total lectures',
      'dash.ofRosterToday': 'of {n} on today’s roster',
      'dash.registered': 'Registered in the system',
      'dash.vsLastWeek': 'vs last week',
      'dash.vsLastMonth': 'vs last month',
      'dash.trendTitle': 'Attendance trend',
      'dash.trendSub': 'Last 14 days · rate against scheduled roster',
      'dash.todayTitle': 'Today’s lectures',
      'dash.todaySub': 'Scheduled sessions and live attendance',
      'dash.recentTitle': 'Recent attendance activity',
      'dash.courseTitle': 'Course performance',
      'dash.courseSub': 'Trailing 30 days',
      'dash.alertsTitle': 'Absence alerts',
      'dash.alertsSub': 'Students needing follow-up',
      'dash.unmarkedTitle': 'Lectures needing attendance',
      'dash.unmarkedSub': 'Past sessions with unrecorded students',
      'dash.quickTitle': 'Quick actions',
      'dash.breakdown': 'Today’s breakdown',
      'dash.weekly': 'Weekly',
      'dash.monthly': 'Monthly',
      'dash.noLecturesToday': 'No lectures scheduled today.',
      'dash.noActivity': 'No attendance recorded yet.',
      'dash.noAlerts': 'No absence alerts. All students are on track.',
      'dash.markAttendance': 'Take attendance',
      'dash.addStudent': 'Add student',
      'dash.newLecture': 'New lecture',
      'dash.newCourse': 'New course',
      'dash.viewReports': 'Reports',
      'dash.qrCards': 'QR cards',
      'students.title': 'Student management',
      'students.subtitle': 'Create, search and manage student records and enrollments.',
      'students.add': 'Add student',
      'students.edit': 'Edit student',
      'students.new': 'New student',
      'students.deleteTitle': 'Delete student?',
      'students.deleteText': 'This removes {name} and their course enrollments. Attendance history is retained for audit.',
      'students.profile': 'Student profile',
      'students.attendanceHistory': 'Attendance history',
      'students.enrollments': 'Enrollments',
      'students.created': 'Student created',
      'students.updated': 'Student updated',
      'students.deleted': 'Student deleted',
      'students.empty': 'No students registered yet',
      'students.emptyDesc': 'Add your first student to start recording attendance.',
      'students.field.id': 'Student ID',
      'students.field.name': 'Full name',
      'students.field.course': 'Programme / course',
      'students.field.level': 'Academic level',
      'students.field.email': 'Email address',
      'students.field.phone': 'Phone number',
      'students.field.status': 'Account status',
      'students.status.active': 'Active',
      'students.status.suspended': 'Suspended',
      'students.status.graduated': 'Graduated',
      'students.status.withdrawn': 'Withdrawn',
      'students.viewProfile': 'View profile',
      'students.qrCard': 'QR card',
      'students.deleteAttendanceNote': 'Attendance records are kept.',
      'qr.title': 'QR cards',
      'qr.subtitle': 'Issue, print and revoke secure student attendance cards.',
      'qr.bulk': 'Bulk generate',
      'qr.downloadAll': 'Download PDF sheet',
      'qr.print': 'Print cards',
      'qr.download': 'PNG',
      'qr.card': 'PDF card',
      'qr.rotate': 'Regenerate',
      'qr.revoke': 'Revoke',
      'qr.revoked': 'Revoked',
      'qr.revokedLabel': 'Card revoked',
      'qr.rotateTitle': 'Regenerate QR code?',
      'qr.rotateText': 'The current code for {name} will stop working immediately. Print the new card afterwards.',
      'qr.revokeTitle': 'Revoke QR code?',
      'qr.revokeText': 'The code for {name} will be rejected at scanners. You can issue a new one later.',
      'qr.rotated': 'New QR code issued',
      'qr.revokedToast': 'QR code revoked',
      'qr.secureNote': 'Cards encode only an opaque token — no personal data. Tokens are validated server-side.',
      'scanner.title': 'QR scanner',
      'scanner.subtitle': 'Scan student cards to record attendance instantly.',
      'scanner.selectLecture': 'Lecture',
      'scanner.selectLectureHint': 'Select the lecture before scanning.',
      'scanner.start': 'Start camera',
      'scanner.stop': 'Stop camera',
      'scanner.upload': 'Upload QR image',
      'scanner.cameraOff': 'Camera is off',
      'scanner.cameraHint': 'Start the camera and hold the student card inside the frame.',
      'scanner.cameraError': 'Camera unavailable. Allow camera permission or upload a QR image instead.',
      'scanner.insecure': 'Camera scanning requires HTTPS or localhost.',
      'scanner.success': 'Attendance recorded',
      'scanner.duplicate': 'Already recorded',
      'scanner.invalid': 'Invalid QR code',
      'scanner.windowClosed': 'Attendance window closed',
      'scanner.log': 'Scan log',
      'scanner.emptyLog': 'Scanned cards will appear here.',
      'scanner.uploading': 'Reading QR image…',
      'scanner.noLectures': 'No lectures available. Create a lecture first.',
      'scanner.session': 'Open session',
      'scanner.finalize': 'Finalise lecture',
      'scanner.finalizeConfirm': 'Mark all unrecorded students as absent and close this session?',
      'scanner.finalized': 'Lecture finalised · {n} marked absent',
      'attendance.title': 'Attendance records',
      'attendance.subtitle': 'Every attendance event with source, status and responsible administrator.',
      'attendance.mark': 'Take attendance',
      'attendance.edit': 'Correct status',
      'attendance.editTitle': 'Correct attendance status',
      'attendance.deleteTitle': 'Delete attendance record?',
      'attendance.deleteText': 'This permanently removes the record for {name}. The action is written to the audit log.',
      'attendance.audit': 'Audit trail',
      'attendance.auditTitle': 'Attendance audit history',
      'attendance.markTitle': 'Take attendance',
      'attendance.markSub': 'Choose a status for each enrolled student.',
      'attendance.saveAll': 'Save attendance',
      'attendance.saved': 'Attendance saved',
      'attendance.empty': 'No attendance records match these filters',
      'attendance.selectLecture': 'Select a lecture to see its roster.',
      'attendance.corrected': 'Status corrected',
      'attendance.deleted': 'Record deleted',
      'courses.title': 'Course management',
      'courses.subtitle': 'Create courses, assign instructors and manage enrollments.',
      'courses.add': 'New course',
      'courses.edit': 'Edit course',
      'courses.code': 'Course code',
      'courses.nameEn': 'Course name (English)',
      'courses.nameAr': 'Course name (Arabic)',
      'courses.department': 'Department',
      'courses.level': 'Academic level',
      'courses.credits': 'Credit hours',
      'courses.instructor': 'Instructor',
      'courses.students': 'Students',
      'courses.archived': 'Archived',
      'courses.archive': 'Archive',
      'courses.restore': 'Restore',
      'courses.deleteTitle': 'Delete course?',
      'courses.deleteText': 'Courses with lectures are archived instead of deleted to protect attendance history.',
      'courses.enroll': 'Enroll students',
      'courses.enrollTitle': 'Enroll students in {course}',
      'courses.enrollHint': 'Search and select students to add to this course.',
      'courses.enrolled': '{n} students enrolled',
      'courses.unenroll': 'Remove',
      'courses.empty': 'No courses yet',
      'courses.emptyDesc': 'Create a course to schedule lectures and track attendance.',
      'courses.created': 'Course created',
      'courses.updated': 'Course updated',
      'courses.archivedToast': 'Course archived',
      'courses.deletedToast': 'Course deleted',
      'courses.includeArchived': 'Include archived',
      'lectures.title': 'Lecture schedule',
      'lectures.subtitle': 'Schedule sessions, define attendance windows and review rosters.',
      'lectures.add': 'New lecture',
      'lectures.edit': 'Edit lecture',
      'lectures.lectureTitle': 'Lecture title',
      'lectures.room': 'Room / hall',
      'lectures.start': 'Start time',
      'lectures.end': 'End time',
      'lectures.opens': 'Attendance opens',
      'lectures.closes': 'Attendance closes',
      'lectures.instructor': 'Instructor / supervisor',
      'lectures.status.scheduled': 'Scheduled',
      'lectures.status.in_progress': 'In progress',
      'lectures.status.completed': 'Completed',
      'lectures.status.cancelled': 'Cancelled',
      'lectures.cancel': 'Cancel lecture',
      'lectures.complete': 'Complete',
      'lectures.deleteTitle': 'Delete lecture?',
      'lectures.deleteText': 'Only lectures without attendance records can be deleted.',
      'lectures.empty': 'No lectures scheduled',
      'lectures.emptyDesc': 'Create a lecture session so students can be marked.',
      'lectures.created': 'Lecture created',
      'lectures.updated': 'Lecture updated',
      'lectures.cancelledToast': 'Lecture cancelled',
      'lectures.roster': 'Roster',
      'lectures.openAttendance': 'Open attendance',
      'reports.title': 'Analytics & reports',
      'reports.subtitle': 'Real data exports in Arabic and English, PDF and Excel.',
      'reports.exportPdf': 'Export PDF',
      'reports.exportXlsx': 'Export Excel',
      'reports.byCourse': 'By course',
      'reports.byStudent': 'By student',
      'reports.byDay': 'By day',
      'reports.studentPdf': 'Student PDF',
      'reports.summary': 'Summary',
      'reports.empty': 'No data for the selected period',
      'reports.emptyDesc': 'Adjust the date range or filters and try again.',
      'users.title': 'Administrators & roles',
      'users.subtitle': 'Manage staff accounts and their permissions.',
      'users.add': 'Add administrator',
      'users.edit': 'Edit account',
      'users.username': 'Username',
      'users.fullName': 'Full name',
      'users.role': 'Role',
      'users.role.super_admin': 'Super Administrator',
      'users.role.admin': 'Administrator',
      'users.role.instructor': 'Instructor',
      'users.status.active': 'Active',
      'users.status.disabled': 'Disabled',
      'users.password': 'Password',
      'users.passwordHint': 'Minimum 12 characters with mixed case, digits or symbols.',
      'users.resetPassword': 'Reset password',
      'users.created': 'Account created',
      'users.updated': 'Account updated',
      'users.deleted': 'Account deleted',
      'users.deleteTitle': 'Delete account?',
      'users.deleteText': 'This permanently removes {name}. Their audit entries stay intact.',
      'users.lastLogin': 'Last sign-in',
      'users.mustChange': 'Password change required',
      'audit.title': 'Audit log',
      'audit.subtitle': 'Every sensitive action, who performed it and when.',
      'audit.action': 'Action',
      'audit.actor': 'Actor',
      'audit.entity': 'Entity',
      'audit.when': 'When',
      'audit.details': 'Details',
      'audit.empty': 'No audit entries yet',
      'settings.title': 'System settings',
      'settings.subtitle': 'Academic period defaults and platform information.',
      'settings.academicYear': 'Academic year',
      'settings.semester': 'Semester',
      'settings.grace': 'Late grace period (minutes)',
      'settings.alert': 'Absence alert threshold (%)',
      'settings.saved': 'Settings saved',
      'settings.backup': 'Download database backup',
      'settings.backupHint': 'Creates a consistent snapshot of the SQLite database.',
      'settings.about': 'About this system',
      'settings.version': 'Version',
      'settings.environment': 'Environment',
      'settings.schema': 'Database schema',
      'settings.database': 'Database engine',
      'password.title': 'Change password',
      'password.sub': 'Your administrator account requires a password change before you continue.',
      'password.current': 'Current password',
      'password.new': 'New password',
      'password.confirm': 'Confirm new password',
      'password.submit': 'Update password',
      'password.mismatch': 'Passwords do not match.',
      'password.weak': 'Use at least 12 characters with mixed letters, digits or symbols.',
      'password.changed': 'Password updated. Please sign in again.',
      'password.requiredTitle': 'Password change required',
      'password.requiredText': 'For security, the initial administrator password must be replaced at first sign-in.',
      'notFound': 'Page not found',
      'notFoundDesc': 'The page you requested does not exist.',
      'accessDenied': 'Access denied',
      'accessDeniedDesc': 'Your role does not allow access to this section.',
      'footer.note': 'University Attendance Management System'
    },
    ar: {
      'app.name': 'حضور الجامعة',
      'app.dept': 'إدارة الشؤون الأكاديمية',
      'app.tagline': 'منصة إدارة الحضور',
      'nav.overview': 'لوحة التحكم',
      'nav.attendance': 'سجل الحضور',
      'nav.students': 'الطلاب',
      'nav.qr': 'بطاقات QR',
      'nav.scanner': 'قارئ الرمز',
      'nav.courses': 'المقررات',
      'nav.lectures': 'المحاضرات',
      'nav.reports': 'التقارير',
      'nav.users': 'المشرفون',
      'nav.audit': 'سجل التدقيق',
      'nav.settings': 'الإعدادات',
      'nav.group.main': 'الرئيسية',
      'nav.group.academic': 'الأكاديمية',
      'nav.group.admin': 'الإدارة',
      'login.title': 'تسجيل الدخول إلى البوابة',
      'login.subtitle': 'استخدم بيانات حساب المشرف الجامعي.',
      'login.identifier': 'اسم المستخدم أو البريد',
      'login.password': 'كلمة المرور',
      'login.submit': 'دخول',
      'login.forgot': 'نسيت كلمة المرور؟',
      'login.hero': 'رؤية دقيقة للحضور لكل محاضرة وطالب وقسم.',
      'login.heroText': 'تابع حضور الطلاب على مستوى الجامعة في الوقت الفعلي، وأصدر بطاقات QR آمنة، وأنتج تقارير جاهزة للتدقيق بالعربية والإنجليزية.',
      'login.feature1': 'تحليلات حضور مباشرة وتنبيهات الغياب',
      'login.feature2': 'بطاقات QR آمنة مع تحقق على الخادم',
      'login.feature3': 'صلاحيات حسب الدور وسجل تدقيق كامل',
      'login.demo': 'دخول آمن للمشرف · جلسات موثقة على الخادم',
      'login.invalid': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      'login.required': 'أدخل اسم المستخدم وكلمة المرور.',
      'login.throttled': 'محاولات فاشلة كثيرة. انتظر قبل المحاولة مرة أخرى.',
      'logout': 'تسجيل الخروج',
      'common.search': 'بحث',
      'common.searchPlaceholder': 'ابحث عن طالب أو رقم أو محاضرة…',
      'common.filter': 'تنقية',
      'common.filters': 'التصفية',
      'common.reset': 'إعادة تعيين',
      'common.clear': 'مسح',
      'common.apply': 'تطبيق',
      'common.all': 'الكل',
      'common.cancel': 'إلغاء',
      'common.save': 'حفظ',
      'common.create': 'إنشاء',
      'common.add': 'إضافة',
      'common.edit': 'تعديل',
      'common.delete': 'حذف',
      'common.close': 'إغلاق',
      'common.confirm': 'تأكيد',
      'common.actions': 'إجراءات',
      'common.status': 'الحالة',
      'common.name': 'الاسم',
      'common.email': 'البريد الإلكتروني',
      'common.phone': 'الهاتف',
      'common.date': 'التاريخ',
      'common.time': 'الوقت',
      'common.from': 'من',
      'common.to': 'إلى',
      'common.course': 'المقرر',
      'common.level': 'المستوى الدراسي',
      'common.student': 'الطالب',
      'common.studentId': 'الرقم الجامعي',
      'common.lectures': 'المحاضرات',
      'common.enrolled': 'المسجلون',
      'common.present': 'حاضر',
      'common.absent': 'غائب',
      'common.late': 'متأخر',
      'common.excused': 'غياب بعذر',
      'common.unmarked': 'لم يسجل',
      'common.attendanceRate': 'نسبة الحضور',
      'common.loading': 'جارٍ التحميل…',
      'common.none': 'لا شيء',
      'common.yes': 'نعم',
      'common.no': 'لا',
      'common.optional': 'اختياري',
      'common.required': 'مطلوب',
      'common.showing': 'عرض {from}–{to} من {total}',
      'common.page': 'صفحة',
      'common.of': 'من',
      'common.prev': 'السابق',
      'common.next': 'التالي',
      'common.export': 'تصدير',
      'common.download': 'تنزيل',
      'common.print': 'طباعة',
      'common.duplicate': 'مكرر',
      'common.today': 'اليوم',
      'common.week': 'هذا الأسبوع',
      'common.month': 'هذا الشهر',
      'common.notes': 'ملاحظات',
      'common.reason': 'السبب',
      'common.source': 'المصدر',
      'common.recordedBy': 'سجّله',
      'common.recordedAt': 'وقت التسجيل',
      'common.never': 'أبدًا',
      'empty.title': 'لا توجد بيانات بعد',
      'empty.desc': 'ستظهر البيانات هنا بعد إضافة السجلات.',
      'empty.search': 'لا توجد نتائج',
      'empty.searchDesc': 'جرّب كلمة بحث أخرى أو امسح التصفية.',
      'error.title': 'حدث خطأ ما',
      'error.retry': 'إعادة المحاولة',
      'error.network': 'الشبكة غير متاحة. تحقق من اتصالك.',
      'error.session': 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
      'notif.loadFailed': 'تعذّر تحميل البيانات',
      'dash.title': 'نظرة عامة على الحضور',
      'dash.subtitle': 'أرقام حقيقية من المحاضرات المجدولة والطلاب المسجلين.',
      'dash.eyebrow': 'لوحة التحكم',
      'dash.totalStudents': 'إجمالي الطلاب',
      'dash.presentToday': 'الحاضرون اليوم',
      'dash.absentToday': 'الغائبون اليوم',
      'dash.lateToday': 'الوصول المتأخر',
      'dash.excused': 'غياب بعذر',
      'dash.rate': 'نسبة الحضور',
      'dash.totalCourses': 'المقررات النشطة',
      'dash.totalLectures': 'إجمالي المحاضرات',
      'dash.ofRosterToday': 'من {n} في قائمة اليوم',
      'dash.registered': 'المسجلون في النظام',
      'dash.vsLastWeek': 'مقارنة بالأسبوع الماضي',
      'dash.vsLastMonth': 'مقارنة بالشهر الماضي',
      'dash.trendTitle': 'اتجاه الحضور',
      'dash.trendSub': 'آخر ١٤ يومًا · النسبة مقابل القائمة المجدولة',
      'dash.todayTitle': 'محاضرات اليوم',
      'dash.todaySub': 'الجلسات المجدولة والحضور المباشر',
      'dash.recentTitle': 'أحدث عمليات الحضور',
      'dash.courseTitle': 'أداء المقررات',
      'dash.courseSub': 'آخر ٣٠ يومًا',
      'dash.alertsTitle': 'تنبيهات الغياب',
      'dash.alertsSub': 'طلاب يحتاجون متابعة',
      'dash.unmarkedTitle': 'محاضرات تحتاج تسجيل حضور',
      'dash.unmarkedSub': 'جلسات سابقة بطلاب غير مسجلين',
      'dash.quickTitle': 'إجراءات سريعة',
      'dash.breakdown': 'توزيع اليوم',
      'dash.weekly': 'أسبوعي',
      'dash.monthly': 'شهري',
      'dash.noLecturesToday': 'لا توجد محاضرات اليوم.',
      'dash.noActivity': 'لم يُسجل حضور بعد.',
      'dash.noAlerts': 'لا توجد تنبيهات غياب. جميع الطلاب منتظمون.',
      'dash.markAttendance': 'تسجيل الحضور',
      'dash.addStudent': 'إضافة طالب',
      'dash.newLecture': 'محاضرة جديدة',
      'dash.newCourse': 'مقرر جديد',
      'dash.viewReports': 'التقارير',
      'dash.qrCards': 'بطاقات QR',
      'students.title': 'إدارة الطلاب',
      'students.subtitle': 'إنشاء وبحث وإدارة بيانات الطلاب والتسجيل في المقررات.',
      'students.add': 'إضافة طالب',
      'students.edit': 'تعديل بيانات الطالب',
      'students.new': 'طالب جديد',
      'students.deleteTitle': 'حذف الطالب؟',
      'students.deleteText': 'سيتم حذف {name} وتسجيلاتهم في المقررات. يبقى سجل الحضور محفوظًا للتدقيق.',
      'students.profile': 'ملف الطالب',
      'students.attendanceHistory': 'سجل الحضور',
      'students.enrollments': 'التسجيلات',
      'students.created': 'تم إضافة الطالب',
      'students.updated': 'تم تحديث البيانات',
      'students.deleted': 'تم حذف الطالب',
      'students.empty': 'لا يوجد طلاب مسجلون',
      'students.emptyDesc': 'أضف أول طالب لبدء تسجيل الحضور.',
      'students.field.id': 'الرقم الجامعي',
      'students.field.name': 'الاسم الكامل',
      'students.field.course': 'البرنامج / المقرر',
      'students.field.level': 'المستوى الدراسي',
      'students.field.email': 'البريد الإلكتروني',
      'students.field.phone': 'رقم الهاتف',
      'students.field.status': 'حالة الطالب',
      'students.status.active': 'منتظم',
      'students.status.suspended': 'موقوف',
      'students.status.graduated': 'متخرج',
      'students.status.withdrawn': 'منسحب',
      'students.viewProfile': 'عرض الملف',
      'students.qrCard': 'بطاقة QR',
      'students.deleteAttendanceNote': 'يُحفظ سجل الحضور.',
      'qr.title': 'بطاقات QR',
      'qr.subtitle': 'إصدار وطباعة وإلغاء بطاقات حضور الطلاب الآمنة.',
      'qr.bulk': 'توليد جماعي',
      'qr.downloadAll': 'تنزيل ورقة PDF',
      'qr.print': 'طباعة البطاقات',
      'qr.download': 'PNG',
      'qr.card': 'بطاقة PDF',
      'qr.rotate': 'تجديد الرمز',
      'qr.revoke': 'إلغاء',
      'qr.revoked': 'ملغاة',
      'qr.revokedLabel': 'بطاقة ملغاة',
      'qr.rotateTitle': 'تجديد رمز QR؟',
      'qr.rotateText': 'سيتوقف الرمز الحالي لـ {name} فورًا. اطبع البطاقة الجديدة بعد ذلك.',
      'qr.revokeTitle': 'إلغاء رمز QR؟',
      'qr.revokeText': 'سيُرفض رمز {name} في أجهزة القراءة. يمكنك إصدار رمز جديد لاحقًا.',
      'qr.rotated': 'تم إصدار رمز QR جديد',
      'qr.revokedToast': 'تم إلغاء رمز QR',
      'qr.secureNote': 'تحتوي البطاقات على رمز عشوائي فقط — دون بيانات شخصية، ويتم التحقق منه على الخادم.',
      'scanner.title': 'قارئ رمز QR',
      'scanner.subtitle': 'امسح بطاقات الطلاب لتسجيل الحضور فورًا.',
      'scanner.selectLecture': 'المحاضرة',
      'scanner.selectLectureHint': 'اختر المحاضرة قبل البدء بالمسح.',
      'scanner.start': 'تشغيل الكاميرا',
      'scanner.stop': 'إيقاف الكاميرا',
      'scanner.upload': 'رفع صورة QR',
      'scanner.cameraOff': 'الكاميرا متوقفة',
      'scanner.cameraHint': 'شغّل الكاميرا وضع بطاقة الطالب داخل الإطار.',
      'scanner.cameraError': 'الكاميرا غير متاحة. اسمح بالوصول أو ارفع صورة QR بدلًا من ذلك.',
      'scanner.insecure': 'المسح بالكاميرا يتطلب HTTPS أو localhost.',
      'scanner.success': 'تم تسجيل الحضور',
      'scanner.duplicate': 'مسجل مسبقًا',
      'scanner.invalid': 'رمز QR غير صالح',
      'scanner.windowClosed': 'نافذة الحضور مغلقة',
      'scanner.log': 'سجل المسح',
      'scanner.emptyLog': 'ستظهر البطاقات الممسوحة هنا.',
      'scanner.uploading': 'جارٍ قراءة صورة QR…',
      'scanner.noLectures': 'لا توجد محاضرات. أنشئ محاضرة أولًا.',
      'scanner.session': 'فتح جلسة',
      'scanner.finalize': 'إغلاق المحاضرة',
      'scanner.finalizeConfirm': 'تسجيل جميع الطلاب غير المسجلين كغائبين وإغلاق الجلسة؟',
      'scanner.finalized': 'تم إغلاق المحاضرة · {n} غائبًا',
      'attendance.title': 'سجلات الحضور',
      'attendance.subtitle': 'كل عملية حضور مع المصدر والحالة والمشرف المسؤول.',
      'attendance.mark': 'تسجيل الحضور',
      'attendance.edit': 'تصحيح الحالة',
      'attendance.editTitle': 'تصحيح حالة الحضور',
      'attendance.deleteTitle': 'حذف سجل الحضور؟',
      'attendance.deleteText': 'سيُحذف سجل {name} نهائيًا وسيُسجل الإجراء في سجل التدقيق.',
      'attendance.audit': 'سجل التدقيق',
      'attendance.auditTitle': 'سجل تدقيق الحضور',
      'attendance.markTitle': 'تسجيل الحضور',
      'attendance.markSub': 'اختر الحالة لكل طالب مسجل.',
      'attendance.saveAll': 'حفظ الحضور',
      'attendance.saved': 'تم حفظ الحضور',
      'attendance.empty': 'لا توجد سجلات مطابقة',
      'attendance.selectLecture': 'اختر محاضرة لعرض قائمتها.',
      'attendance.corrected': 'تم تصحيح الحالة',
      'attendance.deleted': 'تم حذف السجل',
      'courses.title': 'إدارة المقررات',
      'courses.subtitle': 'إنشاء المقررات وتعيين المحاضرين وإدارة التسجيلات.',
      'courses.add': 'مقرر جديد',
      'courses.edit': 'تعديل المقرر',
      'courses.code': 'رمز المقرر',
      'courses.nameEn': 'اسم المقرر (إنجليزي)',
      'courses.nameAr': 'اسم المقرر (عربي)',
      'courses.department': 'القسم',
      'courses.level': 'المستوى الدراسي',
      'courses.credits': 'الساعات المعتمدة',
      'courses.instructor': 'المحاضر',
      'courses.students': 'الطلاب',
      'courses.archived': 'مؤرشف',
      'courses.archive': 'أرشفة',
      'courses.restore': 'استعادة',
      'courses.deleteTitle': 'حذف المقرر؟',
      'courses.deleteText': 'تُؤرشف المقررات التي تحتوي محاضرات بدلًا من حذفها لحماية سجل الحضور.',
      'courses.enroll': 'تسجيل طلاب',
      'courses.enrollTitle': 'تسجيل طلاب في {course}',
      'courses.enrollHint': 'ابحث واختر الطلاب لإضافتهم إلى المقرر.',
      'courses.enrolled': 'تم تسجيل {n} طالبًا',
      'courses.unenroll': 'إزالة',
      'courses.empty': 'لا توجد مقررات',
      'courses.emptyDesc': 'أنشئ مقررًا لجدولة المحاضرات ومتابعة الحضور.',
      'courses.created': 'تم إنشاء المقرر',
      'courses.updated': 'تم تحديث المقرر',
      'courses.archivedToast': 'تم أرشفة المقرر',
      'courses.deletedToast': 'تم حذف المقرر',
      'courses.includeArchived': 'إظهار المؤرشف',
      'lectures.title': 'جدول المحاضرات',
      'lectures.subtitle': 'جدولة الجلسات وتحديد نوافذ الحضور ومراجعة القوائم.',
      'lectures.add': 'محاضرة جديدة',
      'lectures.edit': 'تعديل المحاضرة',
      'lectures.lectureTitle': 'عنوان المحاضرة',
      'lectures.room': 'القاعة',
      'lectures.start': 'وقت البداية',
      'lectures.end': 'وقت النهاية',
      'lectures.opens': 'بداية نافذة الحضور',
      'lectures.closes': 'نهاية نافذة الحضور',
      'lectures.instructor': 'المحاضر / المشرف',
      'lectures.status.scheduled': 'مجدولة',
      'lectures.status.in_progress': 'جارية',
      'lectures.status.completed': 'مكتملة',
      'lectures.status.cancelled': 'ملغاة',
      'lectures.cancel': 'إلغاء المحاضرة',
      'lectures.complete': 'إغلاق',
      'lectures.deleteTitle': 'حذف المحاضرة؟',
      'lectures.deleteText': 'يمكن حذف المحاضرات التي لا تحتوي على سجلات حضور فقط.',
      'lectures.empty': 'لا توجد محاضرات مجدولة',
      'lectures.emptyDesc': 'أنشئ جلسة محاضرة ليتمكن الطلاب من التسجيل.',
      'lectures.created': 'تم إنشاء المحاضرة',
      'lectures.updated': 'تم تحديث المحاضرة',
      'lectures.cancelledToast': 'تم إلغاء المحاضرة',
      'lectures.roster': 'القائمة',
      'lectures.openAttendance': 'فتح الحضور',
      'reports.title': 'التحليلات والتقارير',
      'reports.subtitle': 'تصدير بيانات حقيقية بالعربية والإنجليزية بصيغة PDF و Excel.',
      'reports.exportPdf': 'تصدير PDF',
      'reports.exportXlsx': 'تصدير Excel',
      'reports.byCourse': 'حسب المقرر',
      'reports.byStudent': 'حسب الطالب',
      'reports.byDay': 'حسب اليوم',
      'reports.studentPdf': 'تقرير الطالب PDF',
      'reports.summary': 'الملخص',
      'reports.empty': 'لا توجد بيانات للفترة المحددة',
      'reports.emptyDesc': 'عدّل النطاق الزمني أو التصفية وحاول مجددًا.',
      'users.title': 'المشرفون والأدوار',
      'users.subtitle': 'إدارة حسابات الموظفين وصلاحياتهم.',
      'users.add': 'إضافة مشرف',
      'users.edit': 'تعديل الحساب',
      'users.username': 'اسم المستخدم',
      'users.fullName': 'الاسم الكامل',
      'users.role': 'الدور',
      'users.role.super_admin': 'مشرف عام',
      'users.role.admin': 'مشرف',
      'users.role.instructor': 'محاضر',
      'users.status.active': 'نشط',
      'users.status.disabled': 'معطل',
      'users.password': 'كلمة المرور',
      'users.passwordHint': '١٢ حرفًا على الأقل مع حروف كبيرة وصغيرة وأرقام أو رموز.',
      'users.resetPassword': 'إعادة تعيين كلمة المرور',
      'users.created': 'تم إنشاء الحساب',
      'users.updated': 'تم تحديث الحساب',
      'users.deleted': 'تم حذف الحساب',
      'users.deleteTitle': 'حذف الحساب؟',
      'users.deleteText': 'سيُحذف {name} نهائيًا، مع بقاء سجلات التدقيق الخاصة به.',
      'users.lastLogin': 'آخر دخول',
      'users.mustChange': 'مطلوب تغيير كلمة المرور',
      'audit.title': 'سجل التدقيق',
      'audit.subtitle': 'كل إجراء حساس ومن قام به ومتى.',
      'audit.action': 'الإجراء',
      'audit.actor': 'المستخدم',
      'audit.entity': 'الكيان',
      'audit.when': 'الوقت',
      'audit.details': 'التفاصيل',
      'audit.empty': 'لا توجد سجلات تدقيق',
      'settings.title': 'إعدادات النظام',
      'settings.subtitle': 'إعدادات الفترة الأكاديمية ومعلومات المنصة.',
      'settings.academicYear': 'العام الدراسي',
      'settings.semester': 'الفصل الدراسي',
      'settings.grace': 'فترة السماح للتأخير (دقائق)',
      'settings.alert': 'حد تنبيه الغياب (%)',
      'settings.saved': 'تم حفظ الإعدادات',
      'settings.backup': 'تنزيل نسخة احتياطية',
      'settings.backupHint': 'ينشئ نسخة متسقة من قاعدة بيانات SQLite.',
      'settings.about': 'عن النظام',
      'settings.version': 'الإصدار',
      'settings.environment': 'البيئة',
      'settings.schema': 'إصدار قاعدة البيانات',
      'settings.database': 'محرك قاعدة البيانات',
      'password.title': 'تغيير كلمة المرور',
      'password.sub': 'يتطلب حساب المشرف تغيير كلمة المرور قبل المتابعة.',
      'password.current': 'كلمة المرور الحالية',
      'password.new': 'كلمة المرور الجديدة',
      'password.confirm': 'تأكيد كلمة المرور الجديدة',
      'password.submit': 'تحديث كلمة المرور',
      'password.mismatch': 'كلمتا المرور غير متطابقتين.',
      'password.weak': 'استخدم ١٢ حرفًا على الأقل مع حروف وأرقام أو رموز.',
      'password.changed': 'تم تحديث كلمة المرور. سجّل الدخول مجددًا.',
      'password.requiredTitle': 'تغيير كلمة المرور مطلوب',
      'password.requiredText': 'لأسباب أمنية، يجب تغيير كلمة مرور المشرف الأولية عند أول تسجيل دخول.',
      'notFound': 'الصفحة غير موجودة',
      'notFoundDesc': 'الصفحة المطلوبة غير موجودة.',
      'accessDenied': 'لا يوجد صلاحية',
      'accessDeniedDesc': 'دورك لا يسمح بالوصول إلى هذا القسم.',
      'footer.note': 'نظام إدارة الحضور الجامعي'
    }
  };

  const i18n = {
    lang: state.lang,
    t(key, vars) {
      const table = translations[i18n.lang] || translations.en;
      let value = table[key] ?? translations.en[key] ?? key;
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
        }
      }
      return value;
    },
    setLang(lang) {
      i18n.lang = translations[lang] ? lang : 'en';
      state.lang = i18n.lang;
      localStorage.setItem('attendance.lang', i18n.lang);
      document.documentElement.lang = i18n.lang;
      document.documentElement.dir = i18n.lang === 'ar' ? 'rtl' : 'ltr';
      document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: i18n.lang } }));
    }
  };

  // ------------------------------------------------------------ API client
  function readCookie(name) {
    const match = document.cookie.split('; ').find(row => row.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  }

  class ApiError extends Error {
    constructor(status, payload) {
      super((payload && payload.error) || `Request failed (${status})`);
      this.status = status;
      this.fields = payload && payload.fields;
      this.code = payload && payload.code;
      this.payload = payload;
    }
  }

  const onUnauthorized = new Set();
  function handleUnauthorized() { onUnauthorized.forEach(fn => fn()); }

  async function request(method, path, body, options) {
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    const csrf = readCookie('attendance_csrf') || state.csrf;
    if (method !== 'GET' && method !== 'HEAD' && csrf) headers['X-CSRF-Token'] = csrf;
    if (body !== undefined && body !== null) {
      if (body instanceof Blob || body instanceof File) {
        headers['Content-Type'] = body.type || 'application/octet-stream';
      } else if (typeof body === 'string') {
        headers['Content-Type'] = 'application/json';
      } else {
        headers['Content-Type'] = 'application/json';
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeout || 30000);
    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined || body === null ? undefined : (typeof body === 'string' || body instanceof Blob ? body : JSON.stringify(body)),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      if (error.name === 'AbortError') throw new ApiError(0, { error: 'The request timed out. Please try again.' });
      throw new ApiError(0, { error: 'Network unavailable. Check your connection.' });
    }
    clearTimeout(timer);
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if (!response.ok) throw new ApiError(response.status, { error: `Request failed (${response.status}).` });
      return response;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !opts.silentAuth) handleUnauthorized();
      throw new ApiError(response.status, payload);
    }
    return payload;
  }

  const api = {
    get: (path, options) => request('GET', path, null, options),
    post: (path, body, options) => request('POST', path, body, options),
    put: (path, body, options) => request('PUT', path, body, options),
    del: (path, options) => request('DELETE', path, null, options),
    async download(path, filename) {
      const response = await request('GET', path, null, { timeout: 120000 });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  };

  // ------------------------------------------------------------ DOM helpers
  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else node.setAttribute(key, value === true ? '' : value);
      }
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    });
    return node;
  }
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  function debounce(fn, wait) {
    let timer;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase() || '?';
  }
  /**
   * Numbers always use Western (Latin) digits in both languages — standard for
   * university transcripts and required for consistent table alignment — while
   * the thousands separator and decimal mark follow the locale.
   */
  function formatNumber(value, fractionDigits) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return '0';
    return new Intl.NumberFormat(i18n.lang === 'ar' ? 'en-US' : 'en-US', {
      maximumFractionDigits: fractionDigits === undefined ? 1 : fractionDigits,
      minimumFractionDigits: 0
    }).format(number);
  }
  function formatPercent(value) {
    if (value === null || value === undefined) return '—';
    return `${formatNumber(value, 1)}%`;
  }
  function formatDate(value, { withTime = false } = {}) {
    if (!value) return '—';
    let date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date = new Date(`${value}T00:00:00`);
    else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) date = new Date(`${value.replace(' ', 'T')}Z`);
    else date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const locale = i18n.lang === 'ar' ? 'ar-EG-u-nu-latn-ca-gregory' : 'en-GB';
    const options = withTime
      ? { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
      : { year: 'numeric', month: 'short', day: '2-digit' };
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
  function formatTime(value) {
    if (!value) return '—';
    const match = /^(\d{2}):(\d{2})/.exec(String(value));
    if (!match) return String(value);
    const date = new Date();
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return new Intl.DateTimeFormat(i18n.lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(date);
  }
  function todayIso() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
  }
  function isoDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  // ------------------------------------------------------------ toasts
  let toastStack = null;
  function ensureToasts() {
    if (!toastStack) {
      toastStack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastStack);
    }
    return toastStack;
  }
  function toast(message, { type = 'info', title = '', timeout = 4200 } = {}) {
    const stack = ensureToasts();
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>'
    };
    const node = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, [
      el('span', { class: 't-icon', html: icons[type] || icons.info, 'aria-hidden': 'true' }),
      el('div', { class: 'grow' }, [
        title ? el('b', { text: title }) : null,
        el('p', { text: message })
      ]),
      el('button', {
        class: 't-close', 'aria-label': i18n.t('common.close'),
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        onclick: () => node.remove()
      })
    ]);
    stack.appendChild(node);
    if (timeout) setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateX(16px)'; setTimeout(() => node.remove(), 220); }, timeout);
    return node;
  }

  // ------------------------------------------------------------ modal
  let openModals = 0;
  function modal({ title, subtitle, body, footer, size = '', onClose, closeOnBackdrop = true }) {
    const previousFocus = document.activeElement;
    const backdrop = el('div', { class: 'modal-backdrop', role: 'presentation' });
    const dialog = el('div', { class: `modal ${size}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
    const head = el('div', { class: 'modal-head' }, [
      el('div', {}, [
        el('h3', { text: title || '' }),
        subtitle ? el('p', { text: subtitle }) : null
      ]),
      el('button', {
        class: 'modal-close', type: 'button', 'aria-label': i18n.t('common.close'),
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        onclick: () => close()
      })
    ]);
    const bodyWrap = el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyWrap.innerHTML = body;
    else if (body) bodyWrap.appendChild(body);
    const footWrap = el('div', { class: 'modal-foot' });
    if (footer) {
      if (typeof footer === 'string') footWrap.innerHTML = footer;
      else if (Array.isArray(footer)) footer.forEach(node => node && footWrap.appendChild(node));
      else footWrap.appendChild(footer);
    }
    dialog.appendChild(head);
    dialog.appendChild(bodyWrap);
    if (footer) dialog.appendChild(footWrap);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('no-scroll');
    openModals += 1;

    function close() {
      backdrop.remove();
      openModals = Math.max(0, openModals - 1);
      if (!openModals) document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const focusables = $$('a[href],button:not([disabled]),textarea,input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', dialog)
          .filter(node => node.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    if (closeOnBackdrop) backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });

    // Mark every close button inside the modal body.
    $$('[data-close-modal]', dialog).forEach(button => button.addEventListener('click', close));
    setTimeout(() => {
      const focusable = $('input:not([type=hidden]),select,textarea,button.btn-primary,button', dialog);
      if (focusable) focusable.focus();
    }, 60);
    return { close, dialog, body: bodyWrap, footer: footWrap };
  }

  function confirmDialog({ title, text, confirmLabel, cancelLabel, danger = true }) {
    return new Promise(resolve => {
      let settled = false;
      const done = value => { if (settled) return; settled = true; resolve(value); };
      const ref = modal({
        title,
        body: el('p', { class: 'text-muted', style: 'font-size:13px;line-height:1.7', text }),
        footer: [
          el('button', { class: 'btn', type: 'button', text: cancelLabel || i18n.t('common.cancel'), 'data-close-modal': '', onclick: () => done(false) }),
          el('button', {
            class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, type: 'button',
            text: confirmLabel || i18n.t('common.confirm'),
            onclick: () => { done(true); ref.close(); }
          })
        ],
        onClose: () => done(false)
      });
    });
  }

  // ------------------------------------------------------------ icons
  const ICON_PATHS = {
    dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
    users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
    clipboard: 'M9 2h6a1 1 0 011 1v2H8V3a1 1 0 011-1zM8 5H6a2 2 0 00-2 2v13a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2M8 12h8M8 16h5',
    qr: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 3h3v-3h-3v3zm3 4h4v-4h-4v4zm-3-7h3v3h-3v-3zm7 0h1v1h-1v-1z',
    scan: 'M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M3 12h18',
    book: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
    calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
    chart: 'M18 20V10M12 20V4M6 20v-6',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 3.68 1.65 1.65 0 0010 2.17V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 8v.09a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
    plus: 'M12 5v14M5 12h14',
    search: 'M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z',
    edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
    trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
    download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
    upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
    print: 'M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z',
    check: 'M20 6L9 17l-5-5',
    x: 'M18 6L6 18M6 6l12 12',
    clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
    alert: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01',
    checkCircle: 'M22 11.1V12a10 10 0 11-5.9-9.1M22 4L12 14.01l-3-3',
    logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
    menu: 'M3 12h18M3 6h18M3 18h18',
    chevronLeft: 'M15 18l-6-6 6-6',
    chevronRight: 'M9 18l6-6-6-6',
    globe: 'M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z',
    lock: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4',
    user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
    file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8',
    filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3z',
    bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
    camera: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11zM12 17a4 4 0 100-8 4 4 0 000 8z',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    arrowUp: 'M12 19V5M5 12l7-7 7 7',
    arrowDown: 'M12 5v14M19 12l-7 7-7-7',
    arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
    arrowRight: 'M5 12h14M12 5l7 7-7 7',
    dots: 'M12 13a1 1 0 100-2 1 1 0 000 2zM19 13a1 1 0 100-2 1 1 0 000 2zM5 13a1 1 0 100-2 1 1 0 000 2z',
    info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
    history: 'M3 3v5h5M3.05 13A9 9 0 106 5.3L3 8M12 7v5l4 2',
    archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
    pie: 'M21.2 15.9A10 10 0 118.1 2.8v10h10z',
    graduation: 'M22 10L12 5 2 10l10 5 10-5zM6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5'
  };
  function icon(name, size) {
    const path = ICON_PATHS[name] || ICON_PATHS.info;
    const attrs = size ? ` width="${size}" height="${size}"` : '';
    return `<svg${attrs} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  // ------------------------------------------------------------ misc ui
  function statusBadge(status) {
    const label = i18n.t(`common.${status}`, status);
    return `<span class="badge ${escapeHtml(status)}"><span class="dot"></span>${escapeHtml(label)}</span>`;
  }
  function sourceBadge(source) {
    return `<span class="badge ${escapeHtml(source)}">${escapeHtml(i18n.t(`source.${source}`, source))}</span>`;
  }
  function emptyState({ title, desc, iconName = 'grid', action = '' }) {
    return `<div class="empty">
      <div class="empty-icon">${icon(iconName)}</div>
      <h4>${escapeHtml(title || i18n.t('empty.title'))}</h4>
      <p>${escapeHtml(desc || i18n.t('empty.desc'))}</p>
      ${action}
    </div>`;
  }
  function skeletonCards(count = 4) {
    return Array.from({ length: count }, () => '<div class="skeleton sk-card"></div>').join('');
  }
  function skeletonRows(count = 6) {
    return Array.from({ length: count }, () => '<div class="skeleton sk-row"></div>').join('');
  }
  function errorState(message, retryId) {
    return `<div class="error-panel">
      ${icon('alert')}
      <div class="grow">
        <b>${escapeHtml(i18n.t('error.title'))}</b>
        <div style="margin-top:2px">${escapeHtml(message || '')}</div>
      </div>
      ${retryId ? `<button class="btn btn-sm" data-retry="${escapeHtml(retryId)}">${escapeHtml(i18n.t('error.retry'))}</button>` : ''}
    </div>`;
  }
  function highlight(text, term) {
    const safe = escapeHtml(text);
    if (!term) return safe;
    const escaped = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(`(${escaped})`, 'gi'), '<mark style="background:#F6EFE0;color:#8C6E33;border-radius:3px;padding:0 2px">$1</mark>');
  }

  // ------------------------------------------------------------ charts
  function lineChart(data, opts) {
    const options = opts || {};
    const width = 720;
    const height = options.height || 240;
    const padding = { top: 16, right: 14, bottom: 28, left: 38 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const values = data.map(d => Number(d.value) || 0);
    if (!data.length) return '';
    const max = Math.max(options.max || 100, ...values);
    const min = 0;
    const xStep = data.length > 1 ? innerW / (data.length - 1) : innerW;
    const points = data.map((d, index) => ({
      x: padding.left + index * xStep,
      y: padding.top + innerH - ((Number(d.value) || 0) - min) / (max - min) * innerH,
      data: d
    }));
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = `${path} L${points[points.length - 1].x.toFixed(1)},${padding.top + innerH} L${points[0].x.toFixed(1)},${padding.top + innerH} Z`;
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
      const y = padding.top + innerH - ratio * innerH;
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>
        <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end">${Math.round(min + ratio * (max - min))}${options.unit || ''}</text>`;
    }).join('');
    const labels = points.filter((p, i) => data.length <= 8 || i % Math.ceil(data.length / 8) === 0)
      .map(p => `<text x="${p.x}" y="${height - 8}" text-anchor="middle">${escapeHtml(p.data.label || '')}</text>`).join('');
    const dots = points.map((p, i) => `<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="${i === points.length - 1 ? 4.5 : 3}" fill="${options.color || '#315B83'}"><title>${escapeHtml(String(p.data.title || `${p.data.label}: ${p.data.value}`))}</title></circle>`).join('');
    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(options.ariaLabel || 'line chart')}">
      <defs><linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${options.color || '#315B83'}" stop-opacity=".38"/>
        <stop offset="100%" stop-color="${options.color || '#315B83'}" stop-opacity="0"/>
      </linearGradient></defs>
      <g class="chart-grid">${gridLines}</g>
      <path class="chart-area" d="${area}" fill="url(#lineGrad)"></path>
      <path class="chart-line" d="${path}" stroke="${options.color || '#315B83'}"></path>
      ${dots}
      <g class="chart-axis">${labels}</g>
    </svg></div>`;
  }

  function barChart(data, opts) {
    const options = opts || {};
    const width = 720;
    const height = options.height || 240;
    const padding = { top: 16, right: 14, bottom: 30, left: 38 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    if (!data.length) return '';
    const max = Math.max(options.max || 100, ...data.map(d => Number(d.value) || 0));
    const slot = innerW / data.length;
    const barW = Math.max(6, Math.min(38, slot * .56));
    const bars = data.map((d, index) => {
      const value = Number(d.value) || 0;
      const barH = (value / (max || 1)) * innerH;
      const x = padding.left + slot * index + (slot - barW) / 2;
      const y = padding.top + innerH - barH;
      return `<rect class="chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" rx="4" fill="${d.color || options.color || '#315B83'}">
        <title>${escapeHtml(String(d.title || `${d.label}: ${d.value}`))}</title></rect>
        <text x="${(x + barW / 2).toFixed(1)}" y="${height - 9}" text-anchor="middle" fill="#94A3B3" font-size="10">${escapeHtml(d.label || '')}</text>`;
    }).join('');
    const gridLines = [0, 0.5, 1].map(ratio => {
      const y = padding.top + innerH - ratio * innerH;
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#EEF2F7"/>
        <text x="${padding.left - 8}" y="${y + 3}" text-anchor="end" fill="#94A3B3" font-size="10">${Math.round(ratio * max)}${options.unit || ''}</text>`;
    }).join('');
    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(options.ariaLabel || 'bar chart')}">
      ${gridLines}${bars}</svg></div>`;
  }

  function donutChart(segments, opts) {
    const options = opts || {};
    const size = options.size || 168;
    const stroke = options.stroke || 22;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
    let offset = 0;
    const arcs = segments.map(segment => {
      const value = Number(segment.value) || 0;
      const fraction = total ? value / total : 0;
      const dash = fraction * circumference;
      const arc = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none"
        stroke="${segment.color}" stroke-width="${stroke}" stroke-linecap="butt"
        stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})">
        <title>${escapeHtml(`${segment.label}: ${value}`)}</title></circle>`;
      offset += dash;
      return arc;
    }).join('');
    return `<div class="chart-wrap" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(options.ariaLabel || 'donut chart')}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="#EEF2F7" stroke-width="${stroke}"/>
        ${arcs}
        <g class="donut-center">
          <text x="50%" y="47%" text-anchor="middle" font-size="21" font-weight="700" fill="#142B45">${escapeHtml(options.centerValue ?? total)}</text>
          <text x="50%" y="62%" text-anchor="middle" font-size="10" fill="#718092">${escapeHtml(options.centerLabel || '')}</text>
        </g>
      </svg>
      <div class="donut-legend grow">
        ${segments.map(s => `<div class="donut-legend-row"><i style="background:${s.color}"></i><span>${escapeHtml(s.label)}</span><b>${formatNumber(s.value)}</b></div>`).join('')}
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ pagination
  function pagination({ page, totalPages, total, pageSize }, onPage) {
    const wrap = el('div', { class: 'pagination' });
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(total, page * pageSize);
    wrap.appendChild(el('span', { text: i18n.t('common.showing', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) }) }));
    const pager = el('div', { class: 'pager' });
    const prev = el('button', { type: 'button', 'aria-label': i18n.t('common.prev'), html: icon('chevronLeft'), disabled: page <= 1 });
    prev.addEventListener('click', () => onPage(page - 1));
    pager.appendChild(prev);
    const pages = new Set([1, totalPages, page, page - 1, page + 1]);
    const list = Array.from(pages).filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    let last = 0;
    list.forEach(p => {
      if (p - last > 1) pager.appendChild(el('span', { text: '…', style: 'padding:0 4px;color:#94A3B3' }));
      const button = el('button', { type: 'button', text: String(p), class: p === page ? 'active' : '', 'aria-current': p === page ? 'page' : null });
      button.addEventListener('click', () => { if (p !== page) onPage(p); });
      pager.appendChild(button);
      last = p;
    });
    const next = el('button', { type: 'button', 'aria-label': i18n.t('common.next'), html: icon('chevronRight'), disabled: page >= totalPages });
    next.addEventListener('click', () => onPage(page + 1));
    pager.appendChild(next);
    wrap.appendChild(pager);
    return wrap;
  }

  // ------------------------------------------------------------ misc
  function formData(form) {
    const out = {};
    new FormData(form).forEach((value, key) => {
      if (out[key] !== undefined) {
        out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
      } else out[key] = value;
    });
    return out;
  }
  function fieldErrors(form, fields) {
    $$('.form-field', form).forEach(node => node.classList.remove('invalid'));
    if (!fields) return;
    for (const [name, message] of Object.entries(fields)) {
      const wrapper = form.querySelector(`[data-field="${name}"]`) || form.querySelector(`[name="${name}"]`)?.closest('.form-field');
      if (!wrapper) continue;
      wrapper.classList.add('invalid');
      const error = $('.error', wrapper);
      if (error) error.textContent = message;
    }
    const first = $('.form-field.invalid .field', form);
    if (first) first.focus();
  }
  function busy(button, isBusy) {
    if (!button) return;
    if (isBusy) {
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
    } else {
      button.removeAttribute('aria-busy');
      button.disabled = false;
    }
  }

  window.App = {
    state, setState, subscribe, i18n, t: i18n.t.bind(i18n), api, ApiError,
    el, $, $$, escapeHtml, debounce, initials, formatNumber, formatPercent,
    formatDate, formatTime, todayIso, isoDaysAgo, toast, modal, confirmDialog,
    icon, statusBadge, sourceBadge, emptyState, skeletonCards, skeletonRows,
    errorState, highlight, lineChart, barChart, donutChart, pagination,
    formData, fieldErrors, busy, onUnauthorized, readCookie
  };
})();
