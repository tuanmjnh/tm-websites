import io

VI = """  "about": {
    "title": "Giới thiệu {company}",
    "metaFallback": "Thông tin về {company}.",
    "details": "Thông tin liên hệ",
    "email": "Email",
    "phone": "Điện thoại",
    "address": "Địa chỉ",
    "emptyTitle": "Trang này chưa có nội dung",
    "emptyHint": "Quản trị viên có thể bổ sung mô tả và thông tin công ty trong phần cài đặt của website."
  },
  "contact": {
    "title": "Liên hệ {company}",
    "subtitle": "Thông tin liên hệ chính thức của {company}.",
    "channels": "Kênh liên hệ",
    "email": "Email",
    "phone": "Điện thoại",
    "address": "Địa chỉ",
    "social": "Mạng xã hội",
    "emptyTitle": "Chưa có thông tin liên hệ",
    "emptyHint": "Quản trị viên có thể thêm email, số điện thoại và địa chỉ trong phần cài đặt của website."
  },
"""

EN = """  "about": {
    "title": "About {company}",
    "metaFallback": "Information about {company}.",
    "details": "Contact details",
    "email": "Email",
    "phone": "Phone",
    "address": "Address",
    "emptyTitle": "This page has no content yet",
    "emptyHint": "An administrator can add a description and company details in the website settings."
  },
  "contact": {
    "title": "Contact {company}",
    "subtitle": "The official contact details of {company}.",
    "channels": "Contact channels",
    "email": "Email",
    "phone": "Phone",
    "address": "Address",
    "social": "Social",
    "emptyTitle": "No contact details yet",
    "emptyHint": "An administrator can add an email, phone number and address in the website settings."
  },
"""

for path, block in [('tm-web/i18n/locales/vi.json', VI), ('tm-web/i18n/locales/en.json', EN)]:
    s = io.open(path, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    tail = '  }' + nl + '}' + nl
    assert s.endswith(tail), path
    body = s[:-len(tail)]
    s = body + '  },' + nl + block.replace('\n', nl) + '}' + nl
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    print('patched', path)
