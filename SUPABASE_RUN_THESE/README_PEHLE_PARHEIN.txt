SUPABASE MEIN YEH FILES CHALANI HAIN (Dashboard -> SQL Editor -> New query -> poori file paste -> Run)

Aap ka project pehle se bana hua hai (M12 tak), is liye sirf yeh tarteeb:

  1_UPDATE_DATABASE.sql        Zaroor chalayein. Security fix + password reset + staff ko paise nazar na aayen.
  2_CHECK_SECURITY.sql         Phir chalayein, har query ka result file ke comment jaisa hona chahiye.
  3_CLEAN_TEST_DATA.sql        Dummy data saaf. Pehli dafa kuch delete nahi karti, sirf ginti dikhati hai.
                               Theek lage to file mein 'NO' ko 'YES' karke dobara chalayein. Pehle backup lein.

  0_FULL_SETUP_only_for_a_brand_new_empty_project.sql
                               Sirf tab jab naya KHALI Supabase project bana rahe hon. Purane project par zaroorat nahi.

Function (admin-set-password) aap deploy kar chuke hain, dobara nahi karni.
Baad mein: Storage -> lb-documents -> sab files delete (agar test scans hain).
