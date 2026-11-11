#!/usr/bin/python3 -I
"""Bounded source extraction, executed only inside the unprivileged build sandbox."""
import os
import stat
import sys
import tarfile

NOFOLLOW = os.O_NOFOLLOW | os.O_CLOEXEC
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | NOFOLLOW


def require(value):
    if not value:
        raise ValueError('Unsafe or oversized source archive')


def parent_fd(root, parts, budget=None):
    fd = os.dup(root)
    try:
        for part in parts:
            try:
                os.mkdir(part, mode=0o700, dir_fd=fd)
                if budget is not None:
                    budget['files'] += 1
                    require(budget['files'] <= budget['maxFiles'])
            except FileExistsError:
                pass
            child = os.open(part, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def safe_target(parts, target):
    require(target and not target.startswith('/'))
    stack = list(parts)
    for part in target.split('/'):
        if part in ['', '.']:
            continue
        if part == '..':
            require(bool(stack))
            stack.pop()
        else:
            stack.append(part)
    require(bool(stack))


def verify_link(root, parent, target):
    pending, resolved, depth = list(parent) + target.split('/'), [], 0
    while pending:
        part = pending.pop(0)
        if part in ['', '.']:
            continue
        if part == '..':
            require(bool(resolved))
            resolved.pop()
            continue
        fd = parent_fd(root, resolved)
        try:
            item = os.stat(part, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISLNK(item.st_mode):
                depth += 1
                require(depth <= 40)
                link = os.readlink(part, dir_fd=fd)
                require(link and not link.startswith('/'))
                pending = link.split('/') + pending
            else:
                require(stat.S_ISREG(item.st_mode) or stat.S_ISDIR(item.st_mode))
                require(not pending or stat.S_ISDIR(item.st_mode))
                resolved.append(part)
        finally:
            os.close(fd)


def extract(stream, destination, max_bytes, max_files):
    require(type(max_bytes) is int and max_bytes > 0 and type(max_files) is int and max_files > 0)
    root = os.open(destination, DIRECTORY)
    names, links, prefix, total = set(), [], None, 0
    budget = {'files': 0, 'maxFiles': max_files}
    try:
        with tarfile.open(fileobj=stream, mode='r|*') as archive:
            for member in archive:
                raw = member.name.rstrip('/')
                require(raw and not raw.startswith('/') and '\\' not in raw and not any(ord(c) < 32 for c in raw))
                require(len(raw) <= 4096)
                parts = raw.split('/')
                require(len(parts) <= 65)
                require(all(part not in ['', '.', '..'] for part in parts))
                if prefix is None:
                    prefix = parts[0]
                require(parts[0] == prefix)
                parts = parts[1:]
                if not parts:
                    require(member.isdir())
                    continue
                key = '/'.join(parts)
                require(key not in names and not member.islnk() and (member.isdir() or member.isfile() or member.issym()))
                require(not parts[-1].startswith('.env') or parts[-1] in ['.env.example', '.env.staging.example'])
                names.add(key)
                budget['files'] += 1
                require(budget['files'] <= max_files)
                fd = parent_fd(root, parts[:-1], budget)
                try:
                    name = parts[-1]
                    if member.isdir():
                        try:
                            os.mkdir(name, mode=0o700, dir_fd=fd)
                        except FileExistsError:
                            child = os.open(name, DIRECTORY, dir_fd=fd)
                            os.close(child)
                    elif member.issym():
                        safe_target(parts[:-1], member.linkname)
                        links.append((parts, member.linkname))
                    else:
                        require(member.size >= 0)
                        total += member.size
                        require(total <= max_bytes)
                        target = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NOFOLLOW, 0o700 if member.mode & 0o111 else 0o600, dir_fd=fd)
                        try:
                            source = archive.extractfile(member)
                            remaining = member.size
                            while remaining:
                                block = source.read(min(1024 * 1024, remaining))
                                require(bool(block))
                                view = memoryview(block)
                                while view:
                                    view = view[os.write(target, view):]
                                remaining -= len(block)
                        finally:
                            os.close(target)
                finally:
                    os.close(fd)
        # Links appear only after every ordinary file is extracted, so no later write follows one.
        for parts, target in links:
            fd = parent_fd(root, parts[:-1])
            try:
                os.symlink(target, parts[-1], dir_fd=fd)
            finally:
                os.close(fd)
        for parts, target in links:
            verify_link(root, parts[:-1], target)
        require(budget['files'] > 0)
        return {'bytes': total, 'files': budget['files']}
    finally:
        os.close(root)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 3)
        extract(sys.stdin.buffer, '.', int(sys.argv[1]), int(sys.argv[2]))
    except Exception:
        print('Milo source extraction refused.', file=sys.stderr)
        sys.exit(1)
