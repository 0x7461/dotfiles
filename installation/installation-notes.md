#arch #linux #archlinux

# Arch Linux Installation Notes
## Pre-installation
1. Get installation ISO image
2. Verify signature
3. Create a bootable USB
4. Boot into live environment
5. Keyboard layout and font: default is US layout already so this can be skipped
6. Verify boot mode: `cat /sys/firmware/efi/fw_platform_size`
	- `64`: 64-bit x64 UEFI
	- `32`: 32-bit IA32 UEFI
	- `No such file or directory`: BIOS or CSM mode
	=> Should be in UEFI mode
7. Internet connection: use Ethernet if possible and use `ping` to verify.
8. Update system clock: `timedatectl`
9. Disk partition
	- `lsblk` or `fdisk -l` can be used to list available disks
	- `fdisk` can be used to create disk partitions: `fdisk /dev/disk-to-be-partitioned`
	- Required partitions:
		- root: `/`
		- boot: `/boot`
	- Planned partitions: use swap file (2-4 GB) for flexibility as a safety net.
		- boot: 1 GB, `vfat`, `/boot` 
		- root: 100 GB, `ext4`, `/`
		- home: 700 GB, `ext4`, `/home`
		- leave out some (100 GB or more) for dual boot with Windows later
	- Create and enable swap file can be done after linux installation
10. Format created disk partitions
	- `mkfs.ext4 /dev/root_partition`
	- `mkfs.ext4 /dev/home_partition`
	- `mkfs.fat -F 32 /dev/efi_system_partition`
11. Mount the file systems
	- `mount /dev/root_partition /mnt`
	- `mount /dev/home_partition /mnt/home`
	- `mount --mkdir /dev/efi_system_partition /mnt/boot`
## Installation
1. Select the mirrors.
2. Install the `base` along with a few more essential packages
   `pacstrap -K /mnt base linux linux-firmware intel-ucode dosfstools e2fsprogs ntfs-3g sof-firmware networkmanager neovim man-db man-pages texinfo git fish starship cowsay fortune-mod`
3. Configure the system
	1. fstab: `genfstab -U /mnt >> /mnt/etc/fstab`
	   Check the result in `/mnt/etc/fstab` and edit in case of errors.
	2. Change root: `arch-chroot /mnt`
	3. Time: 
	   `ln -sf /usr/share/zoneinfo/Region/City /etc/localtime`
	   `hwclock --systohc`
	4. Localization: edit `/etc/locale.gen` and un-comment en_US UTF-8 then re-gen the locale with `locale-gen`. Next, create locale config file at `/etc/locale.conf` with the following content: `LANG=en_US.UTF-8`
	5. Set host name by create `/etc/hostname` with the name of computer host `arch` as the content
	6. Generate `initramfs`:  `mkinitcpio -P`
	7. Set root password: `passwd`
	8. Select and install [GRUB boot loader](https://wiki.archlinux.org/title/GRUB)
		1. Install `grub efibootmgr os-prober`
		2. Should be in chroot environment at this point so no need to mount the boot partition to be able to install grub
		3. Install the grub boot loader
		   `grub-install --target=x86_64-efi --efi-directory=/boot --bootloader-id=GRUB`
		4. Enable OS probe in config `/etc/default/grub` by un-commenting GRUB_DISABLE_OS_PROBER line
		5. Add custom entries like Shutdown and Reboot by editing `/etc/grub.d/40_custom` then re-generating `/boot/grub/grub.cfg` by running `grub-mkconfig` 
			1. Shutdown
			   ```
			   menuentry "System shutdown" {
				   echo "System shutting down..."
				   halt
			   }
			   ```
			2. System reboot
			   ```
			   menuentry "System restart" {
				   echo "System rebooting..."
				   reboot
			   }
			   ```
## Reboot
Optionally un-mount all partitions with `unmount -R /mnt` and then `reboot`.
## Post install
1. Add and use a regular user
2. Use Wayland (Hyprland) instead of X-org; which can save some work like configure the DPI or TouchPad.
3. XPS 15 9510 has a Laptop page in Arch wiki with additional information
	1. Arch wiki reference page: [Dell XPS 15 (9510)](https://wiki.archlinux.org/title/Dell_XPS_15_(9510))
	2. There are some notes about UEFI which might be helpful if Arch cannot be installed or boot normally
	3. Powertop to help managing the CPU: [Powertop](https://wiki.archlinux.org/title/Powertop)
	4. NVIDIA: Prime render offload works
	5. Others: Suspend and hibernate, Fan and Thermal control, fingerprint reader, touch pad lag.
4. Create and enable swap file
	   	- `mkswap -U clear --size 4G --file /swapfile`
	   	- `swapon /swapfile`
	   	- edit `fstab` to include the swap file
	   	  `sudo vim /etc/fstab`
		  `/swapfile none swap defaults 0 0`
## Dual boot with Windows
- Use the Ventoy USB to install Windows onto the partition we left out earlier
- After installation, the boot order would be re-arrange by Windows boot loader so go into BIOS to boot into Arch then use `efibootmgr` to re-order the boot loader back to normal
  Arch wiki reference page: [Windows change boot order](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface#Windows_changes_boot_order)
- Also run `os-prober` as root to grab the Windows boot loader and re-generate grub boot loader to include Windows boot entry
  ```shell
  grub-mkconfig -o /boot/grub/grub.cfg
  ```
##### Windows installation notes
1. Windows installation media does not have drivers to recognize NVMe disk (Intel Rapid Storage Technology drivers) so prepare the drivers beforehand and load it when choosing disk to install Windows.
2. Use `privacy.sexy` script to de-bloat after booting into Windows
3. Install Chrome and darktable

