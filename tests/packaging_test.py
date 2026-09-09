import importlib.util
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load_packer(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'build' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CRX = load_packer('pack-crx')
EDGE = load_packer('pack-edge')
FIREFOX = load_packer('pack-firefox')


class PackageTests(unittest.TestCase):
    def test_all_packages_include_license_and_notices(self):
        for module in (CRX, EDGE, FIREFOX):
            self.assertIn('LICENSE', module.INCLUDE_FILES)
            self.assertIn('THIRD_PARTY_NOTICES.txt', module.INCLUDE_FILES)

    def test_missing_signing_key_cannot_create_new_identity(self):
        with tempfile.TemporaryDirectory(prefix='amazonenhanced-package-test-') as folder:
            key = Path(folder) / 'missing.pem'
            with patch.object(CRX, 'KEY_PATH', key):
                with self.assertRaisesRegex(FileNotFoundError, 'Existing signing key'):
                    CRX.load_signing_key()
            self.assertFalse(key.exists())

    def test_missing_source_file_stops_package(self):
        with tempfile.TemporaryDirectory(prefix='amazonenhanced-package-test-') as folder:
            with patch.object(CRX, 'REPO', Path(folder)), patch.object(CRX, 'INCLUDE_FILES', ['missing.js']):
                with self.assertRaises(FileNotFoundError):
                    CRX.zip_extension()

    def test_missing_icon_directory_stops_package(self):
        with tempfile.TemporaryDirectory(prefix='amazonenhanced-package-test-') as folder:
            with patch.object(CRX, 'REPO', Path(folder)), patch.object(CRX, 'INCLUDE_FILES', []):
                with self.assertRaises(FileNotFoundError):
                    CRX.zip_extension()

    def test_zip_paths_and_original_payload(self):
        with tempfile.TemporaryDirectory(prefix='amazonenhanced-package-test-') as folder:
            root = Path(folder)
            (root / 'icons').mkdir()
            (root / '_locales').mkdir()
            (root / 'LICENSE').write_bytes(b'license\r\n')
            (root / 'icons' / '16.png').write_bytes(b'test-image')
            with patch.object(CRX, 'REPO', root), patch.object(CRX, 'INCLUDE_FILES', ['LICENSE']):
                archive = zipfile.ZipFile(io.BytesIO(CRX.zip_extension()))
            self.assertEqual(archive.read('LICENSE'), b'license\r\n')
            self.assertIn('icons/16.png', archive.namelist())
            self.assertTrue(all('\\' not in name for name in archive.namelist()))

    def test_firefox_retains_fixed_identity_and_optional_lookup(self):
        manifest = FIREFOX.build_manifest()
        self.assertEqual(manifest['browser_specific_settings']['gecko']['id'], 'amazonenhanced@sysadmindoc.com')
        self.assertNotIn('sidePanel', manifest['permissions'])
        self.assertIn('https://api.opencorporates.com/*', manifest['optional_host_permissions'])


if __name__ == '__main__':
    unittest.main()
